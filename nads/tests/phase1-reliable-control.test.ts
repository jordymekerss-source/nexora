import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AutomationExecutor } from "../src/adapters/automation-executor.js";
import { HeuristicReviewer, FailClosedReviewer, createReviewerFromEnv } from "../src/adapters/openai-reviewer.js";
import type { GitHubAdapter } from "../src/adapters/github-adapter.js";
import { MemoryStore } from "../src/db/memory-store.js";
import { MemoryOneShotDispatchGate } from "../src/db/one-shot-gate.js";
import { MemoryWebhookReceiptStore } from "../src/db/webhook-receipts.js";
import { PostgresTaskRepository, HydratingMemoryStore } from "../src/db/postgres-task-store.js";
import { createNadsIngressServer } from "../src/ingress/http-server.js";
import {
  completeAutomationTaskFromGitHub,
  dispatchAutomationTask,
} from "../src/orchestrator/automation-lifecycle.js";
import { nadsTaskMarker, nadsBranchPrefix } from "../src/contracts/automation-payload.js";
import { buildGitHubReviewEvidence } from "../src/review/evidence.js";
import { buildRemediationOrder } from "../src/review/remediation-order.js";
import { CodeReviewResultSchema } from "../src/review/schema.js";
import { assertProductionPersistenceConfig } from "../src/config/production-guards.js";
import { UnconfiguredGitHubAdapter } from "../src/adapters/github-adapter.js";

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function completeEvidenceFiles() {
  return [
    {
      filename: "src/feature.ts",
      status: "modified",
      additions: 2,
      deletions: 0,
      patch: "@@\n+export const ok = true;\n+export const ready = 1;\n",
    },
  ];
}

function mockGithub(taskId: string, overrides: Partial<GitHubAdapter> = {}): GitHubAdapter {
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
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40),
      };
    },
    async listPullRequestFiles() {
      return completeEvidenceFiles();
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
        headSha: "a".repeat(40),
        checks: [{ name: "npm test", conclusion: "success" }],
        errors: [],
      };
    },
    ...overrides,
  };
}

describe("phase1: live mode without OpenAI key never ACCEPT", () => {
  it("createReviewerFromEnv live/no-key is FailClosedReviewer", async () => {
    const reviewer = createReviewerFromEnv({ NADS_MODE: "live", OPENAI_API_KEY: "" });
    expect(reviewer).toBeInstanceOf(FailClosedReviewer);
    const decision = await reviewer.review({
      taskTitle: "x",
      acceptanceCriteria: ["a"],
      prompt: "p",
      agentResult: "perfect",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "green" },
    });
    expect(decision.decision).toBe("BLOCKED");
  });

  it("GitHub completion with FailClosedReviewer does not ACCEPT", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({
      title: "t",
      acceptanceCriteria: ["works"],
      status: "AGENT_RUNNING",
      expectedRepoUrl: "https://github.com/jordymekerss-source/nexora",
      expectedTaskMarker: nadsTaskMarker(randomUUID()),
    });
    task.expectedTaskMarker = nadsTaskMarker(task.id);
    task.expectedBranchPrefix = nadsBranchPrefix(task.id);
    const receipts = new MemoryWebhookReceiptStore();
    const body = JSON.stringify({
      action: "opened",
      pull_request: {
        number: 7,
        title: "t",
        html_url: "https://github.com/jordymekerss-source/nexora/pull/7",
        body: nadsTaskMarker(task.id),
        head: { ref: `${nadsBranchPrefix(task.id)}-work`, sha: "a".repeat(40) },
      },
    });
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new FailClosedReviewer("no key"),
      github: mockGithub(task.id),
      verified: {
        deliveryId: "d1",
        event: "pull_request",
        action: "opened",
        taskId: task.id,
        prNumber: 7,
        prUrl: "https://github.com/jordymekerss-source/nexora/pull/7",
        headBranch: `${nadsBranchPrefix(task.id)}-work`,
        payload: JSON.parse(body) as Record<string, unknown>,
      },
      receipts,
      rawBody: body,
    });
    expect(outcome.handled).toBe(true);
    expect(outcome.decision).toBe("BLOCKED");
    expect(store.tasks[0]?.status).toBe("BLOCKED");
    expect(store.tasks[0]?.status).not.toBe("ACCEPTED");
    expect(store.tasks[0]?.status).not.toBe("NEXT_TASK");
  });
});

describe("phase1: incomplete / unreliable evidence", () => {
  it("marks evidence incomplete without patches or checks", () => {
    const evidence = buildGitHubReviewEvidence({
      owner: "o",
      repo: "r",
      prNumber: 1,
      headSha: "h".repeat(40),
      baseSha: "b".repeat(40),
      files: [{ filename: "a.ts", status: "modified", additions: 3, deletions: 0 }],
      checks: [],
      acceptanceCriteria: ["a"],
    });
    expect(evidence.complete).toBe(false);
    expect(evidence.incompleteReasons).toEqual(
      expect.arrayContaining(["missing_patch:a.ts", "missing_ci_checks"]),
    );
  });

  it("REJECT builds deterministic remediation order with paths and tests", () => {
    const review = CodeReviewResultSchema.parse({
      decision: "REJECT",
      summary: "Bug in feature",
      verified_findings: [
        {
          path: "src/feature.ts",
          symbol: "ok",
          problem: "returns false",
          impact: "criteria unmet",
          remediation: "return true",
          verification: "unit test feature",
          certainty: "confirmed",
        },
      ],
      failed_acceptance_criteria: ["feature works"],
      security_findings: [],
      regression_findings: [],
      required_changes: ["Fix src/feature.ts"],
      required_tests: ["npm test", "npm run typecheck"],
      next_task: null,
      confidence: 0.9,
      evidence: {
        commit_hashes: ["a".repeat(40)],
        test_commands: ["npm test"],
        test_exit_codes: [1],
        notes: "failed",
      },
    });
    const evidence = buildGitHubReviewEvidence({
      owner: "jordymekerss-source",
      repo: "nexora",
      prNumber: 9,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      files: completeEvidenceFiles(),
      checks: [{ name: "npm test", conclusion: "failure" }],
      acceptanceCriteria: ["feature works"],
    });
    const order = buildRemediationOrder({
      taskId: "11111111-1111-4111-8111-111111111111",
      review,
      evidence,
    });
    expect(order.decision).toBe("REJECT");
    expect(order.reviewedCommit).toBe("a".repeat(40));
    expect(order.items[0]?.path).toBe("src/feature.ts");
    expect(order.requiredTests).toContain("npm test");
    expect(order.promptMarkdown).toContain("NADS remediation order");
    expect(order.promptMarkdown).toContain("src/feature.ts");
    expect(order.promptMarkdown).toContain("a".repeat(40));
  });
});

describe("phase1: REJECT → remediation on task + retry ceiling", () => {
  it("stores remediation order on REJECT and respects max retries", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({
      title: "repair-me",
      acceptanceCriteria: ["works"],
      status: "AGENT_RUNNING",
      maxRetries: 1,
      expectedRepoUrl: "https://github.com/jordymekerss-source/nexora",
    });
    task.expectedTaskMarker = nadsTaskMarker(task.id);
    task.expectedBranchPrefix = nadsBranchPrefix(task.id);

    const rejecting = {
      async review() {
        return CodeReviewResultSchema.parse({
          decision: "REJECT",
          summary: "Needs fix",
          verified_findings: [
            {
              path: "src/feature.ts",
              symbol: null,
              problem: "broken",
              impact: "fail",
              remediation: "fix it",
              verification: "npm test",
              certainty: "confirmed",
            },
          ],
          failed_acceptance_criteria: ["works"],
          security_findings: [],
          regression_findings: [],
          required_changes: ["Fix src/feature.ts"],
          required_tests: ["npm test"],
          next_task: null,
          confidence: 0.95,
          evidence: {
            commit_hashes: ["a".repeat(40)],
            test_commands: ["npm test"],
            test_exit_codes: [1],
            notes: "fail",
          },
        });
      },
    };

    const first = await completeAutomationTaskFromGitHub({
      store,
      reviewer: rejecting as unknown as HeuristicReviewer,
      github: mockGithub(task.id, {
        async getCheckConclusions() {
          return [{ name: "npm test", conclusion: "failure" }];
        },
      }),
      verified: {
        deliveryId: "rej-1",
        event: "pull_request",
        action: "synchronize",
        taskId: task.id,
        prNumber: 7,
        prUrl: "https://github.com/jordymekerss-source/nexora/pull/7",
        headBranch: `${nadsBranchPrefix(task.id)}-work`,
        payload: {},
      },
      receipts: store.receipts,
      rawBody: "{}",
    });
    expect(first.decision).toBe("REJECT");
    expect(task.lastRemediationOrder).toContain("src/feature.ts");
    expect(task.lastRequiredChanges?.[0]).toMatch(/feature/);
    // maxRetries=1 and retryCount incremented → BLOCKED on second reject ceiling
    expect(["REVISION_REQUIRED", "BLOCKED"]).toContain(task.status);
  });
});

describe("phase1: one-shot + concurrent dispatch + automation disabled", () => {
  it("does not send when automation disabled", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({ title: "t", acceptanceCriteria: ["a"] });
    const fetchImpl = vi.fn();
    const inner = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const outcome = await dispatchAutomationTask({
      store,
      executor: {
        kind: "automation",
        dispatch: (input) => inner.dispatch(input.payload),
      },
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      singleTaskEnv: {
        NADS_AUTOMATION_ENABLED: "false",
        NADS_AUTOMATION_WEBHOOK_URL: "https://example.test/hook",
        NADS_AUTOMATION_WEBHOOK_KEY: "secret",
      },
    });
    expect(outcome.sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("concurrent one-shot consume allows only one winner", async () => {
    const gate = new MemoryOneShotDispatchGate();
    const taskId = randomUUID();
    await gate.arm(taskId);
    const [a, b] = await Promise.all([
      gate.tryConsume({ taskId, consumer: "w1" }),
      gate.tryConsume({ taskId, consumer: "w2" }),
    ]);
    const wins = [a, b].filter((row) => row.ok);
    const losses = [a, b].filter((row) => !row.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((await gate.get())?.status).toBe("consumed");
  });
});

describe("phase1: webhook dedupe + ready/db outage signal", () => {
  it("duplicate same-process delivery returns 409 replay", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({
      title: "t",
      acceptanceCriteria: ["a"],
      status: "AGENT_RUNNING",
    });
    const server = createNadsIngressServer({
      store,
      github: new UnconfiguredGitHubAdapter(),
      reviewer: new HeuristicReviewer(),
      receipts: new MemoryWebhookReceiptStore(),
      githubWebhookSecret: "whsec",
      automationSendEnabled: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${address.port}`;
    const body = JSON.stringify({
      action: "opened",
      pull_request: {
        number: 1,
        title: "t",
        html_url: "https://github.com/o/r/pull/1",
        body: `nads-task:${task.id}`,
        head: { ref: "cursor/nads-x", sha: "abc" },
      },
    });
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": sign(body, "whsec"),
      "x-github-delivery": "phase1-dup-1",
      "x-github-event": "pull_request",
    };
    const first = await fetch(`${base}/webhooks/github`, { method: "POST", headers, body });
    expect(first.status).toBe(200);
    const second = await fetch(`${base}/webhooks/github`, { method: "POST", headers, body });
    expect(second.status).toBe(409);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("/ready is 503 on database outage via readyCheck", async () => {
    const server = createNadsIngressServer({
      store: new MemoryStore(),
      github: new UnconfiguredGitHubAdapter(),
      reviewer: new HeuristicReviewer(),
      receipts: new MemoryWebhookReceiptStore(),
      githubWebhookSecret: "whsec",
      readyCheck: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const ready = await fetch(`http://127.0.0.1:${address.port}/ready`);
    expect(ready.status).toBe(503);
    expect((await ready.json()).ok).toBe(false);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("/health reports automationSend false — no merge/production action", async () => {
    const server = createNadsIngressServer({
      store: new MemoryStore(),
      github: new UnconfiguredGitHubAdapter(),
      reviewer: new HeuristicReviewer(),
      receipts: new MemoryWebhookReceiptStore(),
      githubWebhookSecret: "whsec",
      automationSendEnabled: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    const json = (await health.json()) as { automationSend: boolean };
    expect(json.automationSend).toBe(false);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});

describe("phase1: task store restart hydration (unit)", () => {
  it("HydratingMemoryStore.ensureTask uses repository load + remediation", async () => {
    const taskId = randomUUID();
    const projectId = randomUUID();
    const repo = {
      async loadTask(id: string) {
        if (id !== taskId) return null;
        return {
          id: taskId,
          projectId,
          title: "persisted",
          description: "d",
          priority: 1,
          category: "P0",
          status: "REVISION_REQUIRED" as const,
          acceptanceCriteria: ["a"],
          retryCount: 1,
          maxRetries: 3,
        };
      },
      async loadLatestRemediation() {
        return {
          lastRejectionSummary: "needs fix",
          lastRequiredChanges: ["fix a.ts"],
          lastRemediationOrder: "# NADS remediation order\nFix a.ts",
          lastReviewedHeadSha: "c".repeat(40),
        };
      },
      async persistTaskSnapshot() {},
      async resolveProjectId() {
        return projectId;
      },
      async close() {},
    };
    const store = new HydratingMemoryStore(
      projectId,
      repo as unknown as PostgresTaskRepository,
      new MemoryWebhookReceiptStore(),
    );
    const loaded = await store.ensureTask(taskId);
    expect(loaded?.status).toBe("REVISION_REQUIRED");
    expect(loaded?.lastRemediationOrder).toContain("remediation order");
    expect(loaded?.lastReviewedHeadSha).toBe("c".repeat(40));
    // Second ensure hits memory cache (restart within process)
    const again = await store.ensureTask(taskId);
    expect(again).toBe(loaded);
  });
});

describe("phase1: production guards still refuse unbounded automation", () => {
  it("refuses automation enabled without approved task + postgres gate", () => {
    expect(() =>
      assertProductionPersistenceConfig({
        NADS_PRODUCTION: "true",
        NADS_WEBHOOK_RECEIPT_STORE: "postgres",
        NADS_DISPATCH_STATE_STORE: "postgres",
        DATABASE_URL: "postgresql://nads:nads@127.0.0.1:5432/nads_test",
        NADS_AUTOMATION_ENABLED: "true",
        NADS_SINGLE_TASK_MODE: "false",
      }),
    ).toThrow(/NADS_SINGLE_TASK_MODE/);
  });
});
