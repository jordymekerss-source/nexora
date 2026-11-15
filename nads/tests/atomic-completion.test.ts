import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/memory-store.js";
import {
  MemoryWebhookReceiptStore,
  type WebhookReceiptStore,
} from "../src/db/webhook-receipts.js";
import { FailClosedReviewer } from "../src/adapters/openai-reviewer.js";
import type { GitHubAdapter } from "../src/adapters/github-adapter.js";
import { completeAutomationTaskFromGitHub } from "../src/orchestrator/automation-lifecycle.js";
import { nadsBranchPrefix, nadsTaskMarker } from "../src/contracts/automation-payload.js";
import type { DevelopmentTask } from "../src/db/memory-store.js";
import type { LeaseSettlement } from "../src/db/postgres-task-store.js";

function mockGithub(taskId: string, headSha = "a".repeat(40)): GitHubAdapter {
  const prefix = nadsBranchPrefix(taskId);
  return {
    async createBranch() {},
    async listOpenPullRequests() {
      return [];
    },
    async createPullRequest() {
      return {
        number: 7,
        title: "ok",
        headRef: `${prefix}-work`,
        baseRef: "main",
        url: "https://github.com/jordymekerss-source/nexora/pull/7",
        merged: false,
      };
    },
    async getCheckConclusions() {
      return [{ name: "npm test", conclusion: "success" }];
    },
    async getPullRequest() {
      return {
        number: 7,
        title: "ok",
        headRef: `${prefix}-work`,
        baseRef: "main",
        url: "https://github.com/jordymekerss-source/nexora/pull/7",
        merged: false,
        body: nadsTaskMarker(taskId),
        state: "open",
        draft: true,
        headSha,
        baseSha: "b".repeat(40),
      };
    },
    async listPullRequestFiles() {
      return [
        {
          filename: "src/feature.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          patch: "@@\n+export const ok = true;\n",
        },
      ];
    },
    async branchExists() {
      return true;
    },
    async verifyTaskPullRequest() {
      return {
        ok: true,
        branchExists: true,
        prFound: true,
        markerPresent: true,
        repositoryMatch: true,
        notMerged: true,
        draft: true,
        prNumber: 7,
        prUrl: "https://github.com/jordymekerss-source/nexora/pull/7",
        headBranch: `${prefix}-work`,
        headSha,
        checks: [{ name: "npm test", conclusion: "success" }],
        errors: [],
      };
    },
  };
}

function seedRunningTask(store: MemoryStore, taskId: string): DevelopmentTask {
  const task = store.seedTask({
    id: taskId,
    title: "t",
    description: "d",
    priority: 1,
    category: "P0",
    status: "AGENT_RUNNING",
    acceptanceCriteria: ["works"],
  });
  task.expectedRepoUrl = "https://github.com/jordymekerss-source/nexora";
  task.expectedTaskMarker = nadsTaskMarker(taskId);
  task.expectedBranchPrefix = nadsBranchPrefix(taskId);
  return task;
}

function verified(taskId: string, deliveryId: string) {
  return {
    deliveryId,
    event: "pull_request" as const,
    action: "opened",
    taskId,
    prNumber: 7,
    prUrl: "https://github.com/jordymekerss-source/nexora/pull/7",
    headBranch: `${nadsBranchPrefix(taskId)}-work`,
    payload: {},
  };
}

/** Store that can fail before or after durable persist hooks. */
class InstrumentedMemoryStore extends MemoryStore {
  failBeforePersist = false;
  failAfterPersist = false;
  persistCalls = 0;
  lastSettlement: LeaseSettlement | null = null;

  async persistTask(
    taskId: string,
    options?: { leaseSettlement?: LeaseSettlement },
  ): Promise<{ rowVersion: number; leaseSettledInTxn: boolean }> {
    this.persistCalls += 1;
    this.lastSettlement = options?.leaseSettlement ?? null;
    if (this.failBeforePersist) {
      throw new Error("simulated_db_error_before_persist");
    }
    const task = this.tasks.find((row) => row.id === taskId);
    if (task) {
      task.rowVersion = Number(task.rowVersion ?? 0) + 1;
    }
    if (this.failAfterPersist) {
      throw new Error("simulated_db_error_after_persist");
    }
    // Memory path: lease settle happens via receipts after persist returns.
    return { rowVersion: task?.rowVersion ?? 1, leaseSettledInTxn: false };
  }
}

describe("P0 atomic completion & crash recovery (memory)", () => {
  it("database error before task persist leaves lease reclaimable (no terminal ACCEPT)", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const store = new InstrumentedMemoryStore(randomUUID(), receipts);
    const taskId = randomUUID();
    seedRunningTask(store, taskId);
    store.failBeforePersist = true;

    const failed = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("atomic-before"),
      github: mockGithub(taskId),
      verified: verified(taskId, "before-persist-1"),
      receipts,
      rawBody: "{}",
      leaseOwner: "worker-before",
    });
    expect(failed.handled).toBe(false);
    expect(failed.reason).toBe("persist_failed");

    const task = store.tasks.find((row) => row.id === taskId)!;
    expect(task.status).not.toBe("ACCEPTED");
    expect(task.status).not.toBe("NEXT_TASK");
    // FailClosed → BLOCKED in memory, but persist never committed; lease released on failure.
    const lease = await receipts.getCompletionLease!(store.projectId, taskId);
    expect(lease).toBeNull();

    store.failBeforePersist = false;
    // Simulate restart: durable store never committed the decision; local status rebuilds.
    task.status = "AGENT_RUNNING";
    task.rowVersion = 0;
    const retry = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("atomic-before-retry"),
      github: mockGithub(taskId),
      verified: verified(taskId, "before-persist-2"),
      receipts,
      rawBody: "{}",
      leaseOwner: "worker-before-retry",
    });
    expect(retry.handled).toBe(true);
    expect(retry.decision).not.toBe("ACCEPT");
    expect(store.persistCalls).toBeGreaterThanOrEqual(2);
  });

  it("database error after task persist still settles or reconciles without stuck lease", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const store = new InstrumentedMemoryStore(randomUUID(), receipts);
    const taskId = randomUUID();
    seedRunningTask(store, taskId);
    store.failAfterPersist = true;

    const failed = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("atomic-after"),
      github: mockGithub(taskId),
      verified: verified(taskId, "after-persist-1"),
      receipts,
      rawBody: "{}",
      leaseOwner: "worker-after",
    });
    expect(failed.handled).toBe(false);
    expect(failed.reason).toBe("persist_failed");

    // Persist bumped version then threw before receipts settle; catch released lease.
    const lease = await receipts.getCompletionLease!(store.projectId, taskId);
    expect(lease).toBeNull();

    store.failAfterPersist = false;
    const task = store.tasks.find((row) => row.id === taskId)!;
    // Decision was applied in memory before persist boom — treat as restart from durable non-terminal.
    task.status = "AGENT_RUNNING";
    const again = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("atomic-after-retry"),
      github: mockGithub(taskId),
      verified: verified(taskId, "after-persist-2"),
      receipts,
      rawBody: "{}",
      leaseOwner: "worker-after-retry",
    });
    expect(again.handled).toBe(true);
    expect(again.decision).toBe("BLOCKED");
    expect(again.decision).not.toBe("ACCEPT");
  });

  it("crash between review and completion: lease held until recovery, no false ACCEPT", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const projectId = randomUUID();
    const store = new MemoryStore(projectId, receipts);
    const taskId = randomUUID();
    seedRunningTask(store, taskId);

    const acquired = await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "crash-mid-review",
      leaseOwner: "crashed-worker",
      leaseTtlMs: 60_000,
    });
    expect(acquired.acquired).toBe(true);

    // Simulate crash: review decided in process memory only; never persisted/settled.
    store.transition(taskId, "TESTING", "crash-sim");
    store.transition(taskId, "REVIEWING", "crash-sim");
    // No ACCEPT written.

    const blocked = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("other-worker"),
      github: mockGithub(taskId),
      verified: verified(taskId, "crash-other"),
      receipts,
      rawBody: "{}",
      leaseOwner: "other-worker",
    });
    expect(blocked.handled).toBe(false);
    expect(blocked.reason).toBe("completion_lease_held");
    expect(blocked.decision).toBeUndefined();

    // Expire lease → recovery worker can finish without ACCEPT (FailClosed → BLOCKED).
    await receipts.recoverExpiredLeases({ now: new Date(Date.now() + 120_000) });
    const recovered = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("recovery-worker"),
      github: mockGithub(taskId),
      verified: verified(taskId, "crash-recover"),
      receipts,
      rawBody: "{}",
      leaseOwner: "recovery-worker",
    });
    expect(recovered.handled).toBe(true);
    expect(recovered.decision).toBe("BLOCKED");
    expect(recovered.decision).not.toBe("ACCEPT");
  });

  it("duplicate completion webhooks: second is duplicate_completion or duplicate_delivery", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const store = new MemoryStore(randomUUID(), receipts);
    const taskId = randomUUID();
    seedRunningTask(store, taskId);

    const first = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("dup-1"),
      github: mockGithub(taskId),
      verified: verified(taskId, "dup-delivery"),
      receipts,
      rawBody: "{}",
      leaseOwner: "dup-owner",
    });
    expect(first.handled).toBe(true);

    const secondSameDelivery = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("dup-2"),
      github: mockGithub(taskId),
      verified: verified(taskId, "dup-delivery"),
      receipts,
      rawBody: "{}",
      leaseOwner: "dup-owner-2",
    });
    expect(secondSameDelivery.handled).toBe(false);
    expect(secondSameDelivery.reason).toBe("duplicate_delivery");

    const secondNewDelivery = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("dup-3"),
      github: mockGithub(taskId),
      verified: verified(taskId, "dup-delivery-2"),
      receipts,
      rawBody: "{}",
      leaseOwner: "dup-owner-3",
    });
    expect(secondNewDelivery.handled).toBe(false);
    expect(
      secondNewDelivery.reason === "duplicate_completion" ||
        secondNewDelivery.reason.startsWith("unexpected_status_"),
    ).toBe(true);
  });

  it("reconcile: terminal task + leased claim → duplicate_completion and lease finalized", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const store = new MemoryStore(randomUUID(), receipts);
    const taskId = randomUUID();
    seedRunningTask(store, taskId);
    store.transition(taskId, "TESTING", "t");
    store.transition(taskId, "REVIEWING", "t");
    store.transition(taskId, "BLOCKED", "already done");
    // (valid path: AGENT_RUNNING → TESTING → REVIEWING → BLOCKED)

    await receipts.tryAcquireCompletionLease({
      projectId: store.projectId,
      taskId,
      provider: "github",
      deliveryId: "stuck-lease",
      leaseOwner: "dead-worker",
      leaseTtlMs: 60_000,
    });

    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("reconcile"),
      github: mockGithub(taskId),
      verified: verified(taskId, "reconcile-1"),
      receipts,
      rawBody: "{}",
      leaseOwner: "reconcile-worker",
    });
    expect(outcome.handled).toBe(false);
    expect(outcome.reason).toBe("duplicate_completion");

    const lease = await receipts.getCompletionLease!(store.projectId, taskId);
    expect(lease?.status).toBe("completed");
  });

  it("orphan completed lease on non-terminal task is reclaimable", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const store = new MemoryStore(randomUUID(), receipts);
    const taskId = randomUUID();
    seedRunningTask(store, taskId);

    await receipts.tryAcquireCompletionLease({
      projectId: store.projectId,
      taskId,
      provider: "github",
      deliveryId: "orphan-1",
      leaseOwner: "legacy",
      leaseTtlMs: 60_000,
    });
    await receipts.finalizeCompletionLease({
      projectId: store.projectId,
      taskId,
      leaseOwner: "legacy",
    });
    // Task still AGENT_RUNNING — classic finalize-before-persist crash.
    expect(store.tasks.find((row) => row.id === taskId)?.status).toBe("AGENT_RUNNING");

    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("orphan-reclaim"),
      github: mockGithub(taskId),
      verified: verified(taskId, "orphan-reclaim-1"),
      receipts,
      rawBody: "{}",
      leaseOwner: "reclaimer",
    });
    expect(outcome.handled).toBe(true);
    expect(outcome.decision).toBe("BLOCKED");
    expect(outcome.decision).not.toBe("ACCEPT");
  });

  it("two concurrent workers: only one handles; never dual ACCEPT", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const store = new MemoryStore(randomUUID(), receipts);
    const taskId = randomUUID();
    seedRunningTask(store, taskId);

    const [a, b] = await Promise.all([
      completeAutomationTaskFromGitHub({
        store,
        reviewer: new FailClosedReviewer("w-a"),
        github: mockGithub(taskId),
        verified: verified(taskId, "concurrent-a"),
        receipts,
        rawBody: "{}",
        leaseOwner: "w-a",
      }),
      completeAutomationTaskFromGitHub({
        store,
        reviewer: new FailClosedReviewer("w-b"),
        github: mockGithub(taskId),
        verified: verified(taskId, "concurrent-b"),
        receipts,
        rawBody: "{}",
        leaseOwner: "w-b",
      }),
    ]);

    const handled = [a, b].filter((row) => row.handled);
    const blocked = [a, b].filter((row) => !row.handled);
    expect(handled.length).toBe(1);
    expect(blocked.length).toBe(1);
    expect(handled[0]?.decision).toBe("BLOCKED");
    expect([a, b].some((row) => row.decision === "ACCEPT")).toBe(false);
  });
});

describe("P0 lease reconcile helpers", () => {
  it("reconcileLeaseForTerminalTask finalizes stuck leases", async () => {
    const receipts: WebhookReceiptStore = new MemoryWebhookReceiptStore();
    const projectId = randomUUID();
    const taskId = randomUUID();
    await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "x",
      leaseOwner: "o",
      leaseTtlMs: 60_000,
    });
    const ok = await receipts.reconcileLeaseForTerminalTask!({ projectId, taskId });
    expect(ok).toBe(true);
    const lease = await receipts.getCompletionLease!(projectId, taskId);
    expect(lease?.status).toBe("completed");
  });
});
