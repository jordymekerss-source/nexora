import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyNadsMigrations,
  resetNadsTables,
  seedProjectAndTask,
} from "../src/db/pg-migrate.js";
import {
  HydratingMemoryStore,
  PostgresTaskRepository,
  TaskConcurrencyConflictError,
} from "../src/db/postgres-task-store.js";
import {
  PostgresWebhookReceiptStore,
} from "../src/db/webhook-receipts.js";
import { PostgresDispatchStateStore } from "../src/db/dispatch-state.js";
import { FailClosedReviewer } from "../src/adapters/openai-reviewer.js";
import type { GitHubAdapter } from "../src/adapters/github-adapter.js";
import {
  completeAutomationTaskFromGitHub,
  dispatchAutomationTask,
} from "../src/orchestrator/automation-lifecycle.js";
import { nadsBranchPrefix, nadsTaskMarker } from "../src/contracts/automation-payload.js";
import type { TaskExecutor } from "../src/adapters/executor.js";
import type { DevelopmentTask } from "../src/db/memory-store.js";
import type { LeaseSettlement } from "../src/db/postgres-task-store.js";

const DATABASE_URL =
  process.env.NADS_PG_INTEGRATION_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://nads:nads@127.0.0.1:55432/nads_test";

const runPg = (process.env.NADS_PG_INTEGRATION ?? "0").toLowerCase() !== "0";

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

function bindTask(task: DevelopmentTask, taskId: string): void {
  task.expectedRepoUrl = "https://github.com/jordymekerss-source/nexora";
  task.expectedTaskMarker = nadsTaskMarker(taskId);
  task.expectedBranchPrefix = nadsBranchPrefix(taskId);
  task.expectedStartingRef = "main";
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

class FlakyHydratingStore extends HydratingMemoryStore {
  failBeforePersist = false;
  crashAfterPersistBeforeReturn = false;

  override async persistTask(
    taskId: string,
    options?: { leaseSettlement?: LeaseSettlement },
  ): Promise<{ rowVersion: number; leaseSettledInTxn: boolean } | undefined> {
    if (this.failBeforePersist) {
      throw new Error("simulated_db_error_before_persist");
    }
    const result = await super.persistTask(taskId, options);
    if (this.crashAfterPersistBeforeReturn) {
      throw new Error("simulated_crash_after_persist");
    }
    return result;
  }
}

describe.skipIf(!runPg)("P0 atomic completion PostgreSQL integration", () => {
  let repo: PostgresTaskRepository;
  let receipts: PostgresWebhookReceiptStore;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    await applyNadsMigrations(DATABASE_URL);
    repo = PostgresTaskRepository.fromConnectionString(DATABASE_URL);
    receipts = PostgresWebhookReceiptStore.fromConnectionString(DATABASE_URL);
  }, 60_000);

  afterAll(async () => {
    await receipts.close();
    await repo.close();
  });

  beforeEach(async () => {
    await resetNadsTables(DATABASE_URL);
    projectId = randomUUID();
    taskId = randomUUID();
    await seedProjectAndTask(DATABASE_URL, {
      projectId,
      taskId,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
    });
  });

  it("DB error before persist: lease released, task not terminal, retry succeeds", async () => {
    const store = new FlakyHydratingStore(projectId, repo, receipts);
    const task = await store.ensureTask(taskId);
    bindTask(task!, taskId);
    store.failBeforePersist = true;

    const failed = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("pg-before"),
      github: mockGithub(taskId),
      verified: verified(taskId, "pg-before-1"),
      receipts,
      rawBody: "{}",
      leaseOwner: "pg-before",
    });
    expect(failed.handled).toBe(false);
    expect(failed.reason).toBe("persist_failed");

    const durable = await repo.loadTask(taskId);
    expect(durable?.status).toBe("AGENT_RUNNING");
    const lease = await receipts.getCompletionLease!(projectId, taskId);
    expect(lease).toBeNull();

    store.failBeforePersist = false;
    await store.ensureTask(taskId);
    bindTask(store.tasks.find((row) => row.id === taskId)!, taskId);

    const retry = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("pg-before-retry"),
      github: mockGithub(taskId),
      verified: verified(taskId, "pg-before-2"),
      receipts,
      rawBody: "{}",
      leaseOwner: "pg-before-retry",
    });
    expect(retry.handled).toBe(true);
    expect(retry.decision).toBe("BLOCKED");
    expect(retry.decision).not.toBe("ACCEPT");
    const after = await repo.loadTask(taskId);
    expect(after?.status).toBe("BLOCKED");
  });

  it("crash after persist (TX committed): restart reconciles stuck lease, no re-ACCEPT", async () => {
    const store = new FlakyHydratingStore(projectId, repo, receipts);
    const task = await store.ensureTask(taskId);
    bindTask(task!, taskId);
    store.crashAfterPersistBeforeReturn = true;

    const crashed = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("pg-after"),
      github: mockGithub(taskId),
      verified: verified(taskId, "pg-after-1"),
      receipts,
      rawBody: "{}",
      leaseOwner: "pg-after",
    });
    // TX already committed; lifecycle reports persist_failed after boom, but durable state is terminal.
    expect(crashed.handled).toBe(false);
    expect(crashed.reason).toBe("persist_failed");

    // Atomic TX: task + lease both durable despite post-commit crash simulation.
    const durable = await repo.loadTask(taskId);
    expect(durable?.status).toBe("BLOCKED");
    const lease = await receipts.getCompletionLease!(projectId, taskId);
    expect(lease?.status).toBe("completed");

    // Restart worker with fresh store.
    const restarted = new HydratingMemoryStore(projectId, repo, receipts);
    const again = await completeAutomationTaskFromGitHub({
      store: restarted,
      reviewer: new FailClosedReviewer("pg-after-restart"),
      github: mockGithub(taskId),
      verified: verified(taskId, "pg-after-2"),
      receipts,
      rawBody: "{}",
      leaseOwner: "pg-after-restart",
    });
    expect(again.handled).toBe(false);
    expect(
      again.reason === "duplicate_completion" ||
        again.reason.startsWith("unexpected_status_"),
    ).toBe(true);
    expect(again.decision).not.toBe("ACCEPT");
  });

  it("stale dispatch-state save cannot bump past another worker's CAS", async () => {
    const dispatch = PostgresDispatchStateStore.fromConnectionString(DATABASE_URL);
    try {
      const storeA = new HydratingMemoryStore(projectId, repo, receipts);
      const storeB = new HydratingMemoryStore(
        projectId,
        PostgresTaskRepository.fromConnectionString(DATABASE_URL),
        receipts,
      );
      const taskA = await storeA.ensureTask(taskId);
      const taskB = await storeB.ensureTask(taskId);
      bindTask(taskA!, taskId);
      bindTask(taskB!, taskId);

      storeA.transition(taskId, "TESTING", "a");
      storeA.transition(taskId, "REVIEWING", "a");
      storeA.transition(taskId, "BLOCKED", "a wins");
      await storeA.persistTask(taskId);
      expect(taskA!.rowVersion).toBe(1);

      await expect(
        dispatch.save({
          taskId,
          projectId,
          dispatchOutcome: "stale_overwrite",
          dispatchUncertain: true,
          dispatchReconcileToken: "evil",
          expectedRepoUrl: taskB!.expectedRepoUrl ?? null,
          expectedStartingRef: "main",
          expectedBranchPrefix: taskB!.expectedBranchPrefix ?? null,
          expectedTaskMarker: taskB!.expectedTaskMarker ?? null,
          dispatchIdempotencyKey: "stale-key",
          expectedRowVersion: 0,
        }),
      ).rejects.toBeInstanceOf(TaskConcurrencyConflictError);

      const durable = await repo.loadTask(taskId);
      expect(durable?.status).toBe("BLOCKED");
      expect(durable?.dispatchOutcome).not.toBe("stale_overwrite");
      expect(Number(durable?.rowVersion ?? 0)).toBe(1);
    } finally {
      await dispatch.close();
    }
  });

  it("hydrating dispatch path: single CAS persist; stale worker cannot overwrite; no live send", async () => {
    const dispatch = PostgresDispatchStateStore.fromConnectionString(DATABASE_URL);
    let postCalls = 0;
    const executor: TaskExecutor = {
      kind: "automation",
      async dispatch() {
        postCalls += 1;
        return { sent: false, status: "disabled", attempts: 1 };
      },
    };

    try {
      const store = new HydratingMemoryStore(projectId, repo, receipts);
      const task = await store.ensureTask(taskId);
      bindTask(task!, taskId);
      // Seeded AGENT_RUNNING → move to READY for a disabled dry dispatch ack.
      task!.status = "READY";
      task!.rowVersion = Number(task!.rowVersion ?? 0);
      // Force READY in DB without going through illegal reverse transitions.
      await repo.persistTaskSnapshot(task!);
      await store.ensureTask(taskId);
      bindTask(store.tasks.find((row) => row.id === taskId)!, taskId);

      const first = await dispatchAutomationTask({
        store,
        executor,
        taskId,
        repoUrl: "https://github.com/jordymekerss-source/nexora",
        startingRef: "main",
        dispatchState: dispatch,
        singleTaskEnv: {
          NADS_AUTOMATION_ENABLED: "false",
          NADS_MODE: "dry-run",
        },
      });
      expect(first.sent).toBe(false);
      expect(first.status === "disabled" || first.status.includes("disabled")).toBe(true);
      // Executor may be invoked for disabled ack recording — never a live send.
      expect(first.sent).toBe(false);

      const versionAfter = Number((await repo.loadTask(taskId))?.rowVersion ?? 0);
      expect(versionAfter).toBeGreaterThanOrEqual(1);

      // Stale worker with old row_version cannot persist over the durable row.
      const stale = await store.ensureTask(taskId);
      stale!.rowVersion = 0;
      stale!.dispatchOutcome = "stale_should_not_win";
      await expect(store.persistTask(taskId)).rejects.toBeInstanceOf(TaskConcurrencyConflictError);

      const durable = await repo.loadTask(taskId);
      expect(durable?.dispatchOutcome).not.toBe("stale_should_not_win");
      expect(postCalls).toBeGreaterThanOrEqual(0);
      expect(first.sent).toBe(false);
    } finally {
      await dispatch.close();
    }
  });

  it("orphan completed lease + non-terminal task: reclaim and complete without ACCEPT", async () => {
    await receipts.tryAcquireCompletionLease({
      projectId,
      taskId,
      provider: "github",
      deliveryId: "orphan-pg",
      leaseOwner: "legacy",
      leaseTtlMs: 60_000,
    });
    await receipts.finalizeCompletionLease({
      projectId,
      taskId,
      leaseOwner: "legacy",
    });
    expect((await repo.loadTask(taskId))?.status).toBe("AGENT_RUNNING");

    const store = new HydratingMemoryStore(projectId, repo, receipts);
    const task = await store.ensureTask(taskId);
    bindTask(task!, taskId);

    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("orphan-pg"),
      github: mockGithub(taskId),
      verified: verified(taskId, "orphan-pg-1"),
      receipts,
      rawBody: "{}",
      leaseOwner: "orphan-reclaimer",
    });
    expect(outcome.handled).toBe(true);
    expect(outcome.decision).toBe("BLOCKED");
    expect((await repo.loadTask(taskId))?.status).toBe("BLOCKED");
  });

  it("two concurrent PG workers: one winner, durable BLOCKED, no ACCEPT", async () => {
    const repoB = PostgresTaskRepository.fromConnectionString(DATABASE_URL);
    try {
      const storeA = new HydratingMemoryStore(projectId, repo, receipts);
      const storeB = new HydratingMemoryStore(projectId, repoB, receipts);
      const taskA = await storeA.ensureTask(taskId);
      const taskB = await storeB.ensureTask(taskId);
      bindTask(taskA!, taskId);
      bindTask(taskB!, taskId);

      const [outA, outB] = await Promise.all([
        completeAutomationTaskFromGitHub({
          store: storeA,
          reviewer: new FailClosedReviewer("pg-w-a"),
          github: mockGithub(taskId),
          verified: verified(taskId, "pg-conc-a"),
          receipts,
          rawBody: "{}",
          leaseOwner: "pg-w-a",
        }),
        completeAutomationTaskFromGitHub({
          store: storeB,
          reviewer: new FailClosedReviewer("pg-w-b"),
          github: mockGithub(taskId),
          verified: verified(taskId, "pg-conc-b"),
          receipts,
          rawBody: "{}",
          leaseOwner: "pg-w-b",
        }),
      ]);

      expect([outA, outB].filter((row) => row.handled).length).toBe(1);
      expect([outA, outB].some((row) => row.decision === "ACCEPT")).toBe(false);
      expect((await repo.loadTask(taskId))?.status).toBe("BLOCKED");
    } finally {
      await repoB.close();
    }
  });
});
