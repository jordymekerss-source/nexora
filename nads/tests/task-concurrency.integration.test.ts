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
  isTaskConcurrencyConflictError,
} from "../src/db/postgres-task-store.js";
import {
  MemoryWebhookReceiptStore,
  PostgresWebhookReceiptStore,
} from "../src/db/webhook-receipts.js";
import { FailClosedReviewer } from "../src/adapters/openai-reviewer.js";
import type { GitHubAdapter } from "../src/adapters/github-adapter.js";
import { completeAutomationTaskFromGitHub } from "../src/orchestrator/automation-lifecycle.js";
import { nadsBranchPrefix, nadsTaskMarker } from "../src/contracts/automation-payload.js";
import { CodeReviewResultSchema } from "../src/review/schema.js";

const DATABASE_URL =
  process.env.NADS_PG_INTEGRATION_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://nads:nads@127.0.0.1:55432/nads_test";

const runPg = (process.env.NADS_PG_INTEGRATION ?? "0").toLowerCase() !== "0";

function mockGithub(taskId: string, headSha: string): GitHubAdapter {
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

describe.skipIf(!runPg)("P0 PostgreSQL task concurrency (dual connections)", () => {
  let repoA: PostgresTaskRepository;
  let repoB: PostgresTaskRepository;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    await applyNadsMigrations(DATABASE_URL);
    // Two independent pools/connections — simulates two workers.
    repoA = PostgresTaskRepository.fromConnectionString(DATABASE_URL);
    repoB = PostgresTaskRepository.fromConnectionString(DATABASE_URL);
  }, 60_000);

  afterAll(async () => {
    await repoA.close();
    await repoB.close();
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

  it("CAS: second worker loses when writing stale row_version", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const storeA = new HydratingMemoryStore(projectId, repoA, receipts);
    const storeB = new HydratingMemoryStore(projectId, repoB, receipts);

    const taskA = await storeA.ensureTask(taskId);
    const taskB = await storeB.ensureTask(taskId);
    expect(taskA?.rowVersion).toBe(0);
    expect(taskB?.rowVersion).toBe(0);

    storeA.transition(taskId, "TESTING", "worker-a");
    storeA.transition(taskId, "REVIEWING", "worker-a");
    storeA.transition(taskId, "BLOCKED", "worker-a wins");
    await storeA.persistTask(taskId);
    expect(taskA!.rowVersion).toBe(1);

    // Stale worker B still holds version 0 and tries to write a different terminal path.
    storeB.transition(taskId, "TESTING", "worker-b");
    storeB.transition(taskId, "REVIEWING", "worker-b");
    storeB.transition(taskId, "ACCEPTED", "stale accept");
    storeB.transition(taskId, "NEXT_TASK", "stale next");

    await expect(storeB.persistTask(taskId)).rejects.toBeInstanceOf(TaskConcurrencyConflictError);
    try {
      await storeB.persistTask(taskId);
    } catch (error) {
      expect(isTaskConcurrencyConflictError(error)).toBe(true);
      if (isTaskConcurrencyConflictError(error)) {
        expect(error.reason).toBe("row_version_mismatch");
        expect(error.actualStatus).toBe("BLOCKED");
        expect(error.actualVersion).toBe(1);
      }
    }

    const fresh = await storeA.ensureTask(taskId);
    expect(fresh?.status).toBe("BLOCKED");
    expect(fresh?.rowVersion).toBe(1);
  });

  it("refuses terminal overwrite even if versions were somehow aligned", async () => {
    const storeA = new HydratingMemoryStore(projectId, repoA, new MemoryWebhookReceiptStore());
    const task = await storeA.ensureTask(taskId);
    storeA.transition(taskId, "TESTING", "a");
    storeA.transition(taskId, "REVIEWING", "a");
    storeA.transition(taskId, "BLOCKED", "terminal");
    await storeA.persistTask(taskId);

    // Force a pathological local state: same version token but non-terminal status.
    task!.status = "AGENT_RUNNING";
    task!.rowVersion = 1;
    await expect(storeA.persistTask(taskId)).rejects.toMatchObject({
      reason: "terminal_status_overwrite_refused",
    });
  });

  it("ensureTask always refreshes stale in-memory status after peer write", async () => {
    const storeA = new HydratingMemoryStore(projectId, repoA, new MemoryWebhookReceiptStore());
    const storeB = new HydratingMemoryStore(projectId, repoB, new MemoryWebhookReceiptStore());
    const cached = await storeA.ensureTask(taskId);
    expect(cached?.status).toBe("AGENT_RUNNING");
    cached!.expectedRepoUrl = "https://github.com/jordymekerss-source/nexora";

    await storeB.ensureTask(taskId);
    storeB.transition(taskId, "TESTING", "peer");
    storeB.transition(taskId, "REVIEWING", "peer");
    storeB.transition(taskId, "BLOCKED", "peer");
    await storeB.persistTask(taskId);

    const refreshed = await storeA.ensureTask(taskId);
    expect(refreshed?.status).toBe("BLOCKED");
    expect(refreshed?.rowVersion).toBe(1);
    // Same working object updated in place; local binding preserved; status from DB.
    expect(refreshed).toBe(cached);
    expect(cached?.expectedRepoUrl).toBe("https://github.com/jordymekerss-source/nexora");
  });

  it("concurrent completion: lease + CAS keep a single durable terminal status", async () => {
    const sharedReceipts = PostgresWebhookReceiptStore.fromConnectionString(DATABASE_URL);
    try {
      const storeA = new HydratingMemoryStore(projectId, repoA, sharedReceipts);
      const storeB = new HydratingMemoryStore(projectId, repoB, sharedReceipts);
      const taskA = await storeA.ensureTask(taskId);
      const taskB = await storeB.ensureTask(taskId);
      expect(taskA && taskB).toBeTruthy();
      taskA!.expectedRepoUrl = "https://github.com/jordymekerss-source/nexora";
      taskA!.expectedTaskMarker = nadsTaskMarker(taskId);
      taskA!.expectedBranchPrefix = nadsBranchPrefix(taskId);
      taskB!.expectedRepoUrl = taskA!.expectedRepoUrl;
      taskB!.expectedTaskMarker = taskA!.expectedTaskMarker;
      taskB!.expectedBranchPrefix = taskA!.expectedBranchPrefix;

      const head = "a".repeat(40);
      const body = JSON.stringify({
        action: "opened",
        pull_request: {
          number: 7,
          title: "t",
          html_url: "https://github.com/jordymekerss-source/nexora/pull/7",
          body: nadsTaskMarker(taskId),
          head: { ref: `${nadsBranchPrefix(taskId)}-work`, sha: head },
        },
      });

      const [outA, outB] = await Promise.all([
        completeAutomationTaskFromGitHub({
          store: storeA,
          reviewer: new FailClosedReviewer("worker-a"),
          github: mockGithub(taskId, head),
          verified: {
            deliveryId: "concurrent-a",
            event: "pull_request",
            action: "opened",
            taskId,
            prNumber: 7,
            prUrl: "https://github.com/jordymekerss-source/nexora/pull/7",
            headBranch: `${nadsBranchPrefix(taskId)}-work`,
            payload: JSON.parse(body) as Record<string, unknown>,
          },
          receipts: sharedReceipts,
          rawBody: body,
          leaseOwner: "worker-a",
        }),
        completeAutomationTaskFromGitHub({
          store: storeB,
          reviewer: new FailClosedReviewer("worker-b"),
          github: mockGithub(taskId, head),
          verified: {
            deliveryId: "concurrent-b",
            event: "pull_request",
            action: "opened",
            taskId,
            prNumber: 7,
            prUrl: "https://github.com/jordymekerss-source/nexora/pull/7",
            headBranch: `${nadsBranchPrefix(taskId)}-work`,
            payload: JSON.parse(body) as Record<string, unknown>,
          },
          receipts: sharedReceipts,
          rawBody: body,
          leaseOwner: "worker-b",
        }),
      ]);

      const winners = [outA, outB].filter((row) => row.handled && row.decision === "BLOCKED");
      const losers = [outA, outB].filter((row) => !row.handled);
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
      expect([outA, outB].some((row) => row.decision === "ACCEPT")).toBe(false);

      const durable = await repoA.loadTask(taskId);
      expect(durable?.status).toBe("BLOCKED");
      expect(Number(durable?.rowVersion ?? 0)).toBeGreaterThanOrEqual(1);
    } finally {
      await sharedReceipts.close();
    }
  });

  it("blocks ACCEPT when PR head SHA changes before accept is recorded", async () => {
    const receipts = new MemoryWebhookReceiptStore();
    const store = new HydratingMemoryStore(projectId, repoA, receipts);
    const task = await store.ensureTask(taskId);
    task!.expectedRepoUrl = "https://github.com/jordymekerss-source/nexora";
    task!.expectedTaskMarker = nadsTaskMarker(taskId);
    task!.expectedBranchPrefix = nadsBranchPrefix(taskId);

    let calls = 0;
    const headInitial = "1".repeat(40);
    const headMoved = "2".repeat(40);
    const github = mockGithub(taskId, headInitial);
    github.getPullRequest = async () => {
      calls += 1;
      const sha = calls <= 2 ? headInitial : headMoved; // evidence + mid-check use initial; accept verify sees move
      return {
        number: 7,
        title: "ok",
        headRef: `${nadsBranchPrefix(taskId)}-work`,
        baseRef: "main",
        url: "https://github.com/jordymekerss-source/nexora/pull/7",
        merged: false,
        body: nadsTaskMarker(taskId),
        state: "open",
        draft: true,
        headSha: sha,
        baseSha: "b".repeat(40),
      };
    };

    // Accepting reviewer that would ACCEPT without the SHA gate.
    const accepting = {
      async review() {
        return CodeReviewResultSchema.parse({
          decision: "ACCEPT",
          summary: "would accept",
          verified_findings: [],
          failed_acceptance_criteria: [],
          security_findings: [],
          regression_findings: [],
          required_changes: [],
          required_tests: [],
          next_task: "x",
          confidence: 1,
          evidence: {
            commit_hashes: [headInitial],
            test_commands: ["npm test"],
            test_exit_codes: [0],
            notes: "mock",
          },
        });
      },
    };

    // Force evidence complete path by using OpenAI-like acceptor — but SHA verify runs after.
    // FailClosed would BLOCK before SHA check; use accepting mock instead.
    const body = "{}";
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: accepting as unknown as FailClosedReviewer,
      github,
      verified: {
        deliveryId: "sha-move-1",
        event: "pull_request",
        action: "synchronize",
        taskId,
        prNumber: 7,
        prUrl: "https://github.com/jordymekerss-source/nexora/pull/7",
        headBranch: `${nadsBranchPrefix(taskId)}-work`,
        payload: {},
      },
      receipts,
      rawBody: body,
    });

    expect(outcome.decision).toBe("BLOCKED");
    expect(outcome.handled).toBe(true);
    const durable = await repoA.loadTask(taskId);
    expect(durable?.status).toBe("BLOCKED");
    expect(durable?.status).not.toBe("ACCEPTED");
    expect(durable?.status).not.toBe("NEXT_TASK");
  });
});
