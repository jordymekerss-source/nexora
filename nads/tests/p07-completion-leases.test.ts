import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HeuristicReviewer } from "../src/adapters/openai-reviewer.js";
import type { GitHubAdapter } from "../src/adapters/github-adapter.js";
import { createExecutorFromEnv } from "../src/adapters/executor.js";
import { MemoryStore } from "../src/db/memory-store.js";
import { MemoryWebhookReceiptStore } from "../src/db/webhook-receipts.js";
import {
  completeAutomationTaskFromGitHub,
  dispatchAutomationTask,
} from "../src/orchestrator/automation-lifecycle.js";
import { verifyGitHubWebhookSignature } from "../src/ingress/github-webhook.js";
import { nadsBranchPrefix, nadsTaskMarker } from "../src/contracts/automation-payload.js";

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function mockGithub(taskId: string, overrides?: Partial<GitHubAdapter>): GitHubAdapter {
  const prefix = nadsBranchPrefix(taskId);
  const base: GitHubAdapter = {
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
      return [{ name: "test", conclusion: "success" }];
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
        headSha: "abc",
      };
    },
    async listPullRequestFiles() {
      return [{ filename: "README.md", status: "modified", additions: 1, deletions: 0 }];
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
        headSha: "abc",
        checks: [],
        errors: [],
      };
    },
  };
  return { ...base, ...overrides };
}

async function seedRunningTask(receipts: MemoryWebhookReceiptStore) {
  const store = new MemoryStore(randomUUID(), receipts);
  const task = store.seedTask({
    title: "Lease",
    description: "demo",
    acceptanceCriteria: ["Recover from planted failure"],
  });
  await dispatchAutomationTask({
    store,
    executor: createExecutorFromEnv({
      NADS_EXECUTOR: "automation",
      NADS_AUTOMATION_ENABLED: "false",
    }),
    taskId: task.id,
    repoUrl: "https://github.com/jordymekerss-source/nexora",
    receipts,
  });
  return { store, task };
}

function mkVerified(taskId: string, deliveryId: string) {
  const body = JSON.stringify({
    action: "opened",
    pull_request: {
      number: 7,
      title: "ok",
      html_url: "https://github.com/jordymekerss-source/nexora/pull/7",
      body: nadsTaskMarker(taskId),
      head: { ref: `${nadsBranchPrefix(taskId)}-work`, sha: "abc" },
    },
  });
  const secret = "whsec";
  return {
    body,
    verified: verifyGitHubWebhookSignature(
      body,
      {
        "x-hub-signature-256": sign(body, secret),
        "x-github-delivery": deliveryId,
        "x-github-event": "pull_request",
      },
      { secret },
    ),
  };
}

describe("P0.7.1 recoverable completion claim leases", () => {
  it("releases lease after failure immediately after claim (before PR retrieval)", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const { store, task } = await seedRunningTask(receipts);
    const { body, verified } = mkVerified(task.id, "lease-fail-claim");

    const github = mockGithub(task.id, {
      async verifyTaskPullRequest() {
        throw new Error("boom after lease");
      },
    });

    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github,
      verified,
      receipts,
      rawBody: body,
      leaseOwner: "worker-a",
    });
    expect(outcome.handled).toBe(false);
    expect(outcome.reason).toBe("completion_failed");
    expect(await receipts.getCompletionLease?.(store.projectId, task.id)).toBeNull();
    expect(store.tasks[0]?.status).toBe("AGENT_RUNNING");

    // Recoverable: another worker can complete after release.
    const retry = mkVerified(task.id, "lease-fail-claim-retry");
    const again = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github: mockGithub(task.id),
      verified: retry.verified,
      receipts,
      rawBody: retry.body,
      leaseOwner: "worker-b",
    });
    expect(again.handled).toBe(true);
    expect(store.tasks[0]?.status).toBe("NEXT_TASK");
  });

  it("releases lease when PR retrieval fails", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const { store, task } = await seedRunningTask(receipts);
    const { body, verified } = mkVerified(task.id, "lease-pr-fail");
    const github = mockGithub(task.id, {
      async getPullRequest() {
        throw new Error("GitHub 502");
      },
    });
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github,
      verified,
      receipts,
      rawBody: body,
      leaseOwner: "worker-pr",
    });
    expect(outcome.reason).toBe("pr_retrieval_failed");
    expect(await receipts.getCompletionLease?.(store.projectId, task.id)).toBeNull();
    expect(store.tasks[0]?.status).not.toBe("NEXT_TASK");
    expect(store.tasks[0]?.status).not.toBe("ACCEPTED");
  });

  it("releases lease when review throws and does not mark completed", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const { store, task } = await seedRunningTask(receipts);
    const { body, verified } = mkVerified(task.id, "lease-review-fail");
    const reviewer = {
      async review() {
        throw new Error("reviewer exploded");
      },
    };
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: reviewer as unknown as HeuristicReviewer,
      github: mockGithub(task.id),
      verified,
      receipts,
      rawBody: body,
      leaseOwner: "worker-review",
    });
    expect(outcome.reason).toBe("review_failed");
    expect(await receipts.getCompletionLease?.(store.projectId, task.id)).toBeNull();
    expect(["AGENT_RUNNING", "TESTING", "REVIEWING"]).toContain(store.tasks[0]?.status);
    expect(store.tasks[0]?.status).not.toBe("NEXT_TASK");
  });

  it("recovers expired leases for a new worker", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const projectId = randomUUID();
    const taskId = randomUUID();
    const past = new Date(Date.now() - 60_000);
    const first = await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "d1",
      leaseOwner: "crashed-worker",
      leaseTtlMs: 10,
      now: past,
    });
    expect(first.acquired).toBe(true);

    const recovered = await receipts.recoverExpiredLeases({ now: new Date() });
    expect(recovered).toBeGreaterThanOrEqual(1);

    const second = await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "d2",
      leaseOwner: "recovery-worker",
      leaseTtlMs: 60_000,
    });
    expect(second.acquired).toBe(true);
    if (second.acquired) {
      expect(second.lease.leaseOwner).toBe("recovery-worker");
    }
  });

  it("prevents concurrent workers from both holding the lease", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const projectId = randomUUID();
    const taskId = randomUUID();
    const a = await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "a",
      leaseOwner: "w1",
    });
    const b = await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "b",
      leaseOwner: "w2",
    });
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
    if (!b.acquired) expect(b.reason).toBe("held");
  });

  it("process restart recovery: expired lease allows completion", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const { store, task } = await seedRunningTask(receipts);
    // Simulate prior crashed worker that left an expired lease.
    await receipts.tryAcquireCompletionLease({
      projectId: store.projectId,
      taskId: task.id,
      provider: "github",
      deliveryId: "stale",
      leaseOwner: "dead-process",
      leaseTtlMs: 1,
      now: new Date(Date.now() - 30_000),
    });

    const { body, verified } = mkVerified(task.id, "restart-ok");
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github: mockGithub(task.id),
      verified,
      receipts,
      rawBody: body,
      leaseOwner: "restarted-worker",
    });
    expect(outcome.handled).toBe(true);
    expect(outcome.decision).toBe("ACCEPT");
  });

  it("releases lease on REJECT so a later attempt can complete", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const { store, task } = await seedRunningTask(receipts);
    const rejectReviewer = {
      async review() {
        return {
          decision: "REJECT" as const,
          summary: "needs work",
          verified_findings: [],
          failed_acceptance_criteria: ["Recover from planted failure"],
          security_findings: [],
          regression_findings: [],
          required_changes: ["fix tests"],
          required_tests: [],
          next_task: null,
          confidence: 0.9,
          evidence: {
            commit_hashes: [],
            test_commands: [],
            test_exit_codes: [],
            notes: "reject path",
          },
        };
      },
    };
    const first = mkVerified(task.id, "reject-1");
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: rejectReviewer as unknown as HeuristicReviewer,
      github: mockGithub(task.id),
      verified: first.verified,
      receipts,
      rawBody: first.body,
      leaseOwner: "w-reject",
    });
    expect(outcome.handled).toBe(true);
    expect(outcome.decision).toBe("REJECT");
    expect(await receipts.getCompletionLease?.(store.projectId, task.id)).toBeNull();
    expect(store.tasks[0]?.status).toBe("REVISION_REQUIRED");

    // Re-dispatch and complete successfully.
    await dispatchAutomationTask({
      store,
      executor: createExecutorFromEnv({
        NADS_EXECUTOR: "automation",
        NADS_AUTOMATION_ENABLED: "false",
      }),
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      receipts,
    });
    const second = mkVerified(task.id, "reject-2");
    const again = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github: mockGithub(task.id),
      verified: second.verified,
      receipts,
      rawBody: second.body,
      leaseOwner: "w-accept",
    });
    expect(again.handled).toBe(true);
    expect(again.decision).toBe("ACCEPT");
  });
});

describe("P0.7.1 memory lease API", () => {
  it("same owner can renew; finalize blocks others", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const projectId = randomUUID();
    const taskId = randomUUID();
    const first = await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "d",
      leaseOwner: "owner",
    });
    expect(first.acquired).toBe(true);
    const renew = await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "d2",
      leaseOwner: "owner",
    });
    expect(renew.acquired).toBe(true);
    await receipts.finalizeCompletionLease({ projectId, taskId, leaseOwner: "owner" });
    const other = await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "d3",
      leaseOwner: "other",
    });
    expect(other.acquired).toBe(false);
    if (!other.acquired) expect(other.reason).toBe("completed");
  });
});

// silence unused vi import if not used
void vi;
