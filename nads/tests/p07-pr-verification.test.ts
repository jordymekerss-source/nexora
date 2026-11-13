import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  HttpGitHubAdapter,
  UnconfiguredGitHubAdapter,
  createGitHubAdapterFromEnv,
  parseGithubRepoUrl,
} from "../src/adapters/github-adapter.js";
import { HeuristicReviewer } from "../src/adapters/openai-reviewer.js";
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

describe("P0.7.3 parseGithubRepoUrl", () => {
  it("parses https and ssh", () => {
    expect(parseGithubRepoUrl("https://github.com/jordymekerss-source/nexora")).toEqual({
      owner: "jordymekerss-source",
      repo: "nexora",
    });
    expect(parseGithubRepoUrl("git@github.com:acme/app.git")).toEqual({
      owner: "acme",
      repo: "app",
    });
  });
});

describe("P0.7.3 mandatory GitHub PR verification", () => {
  async function prepare() {
    const receipts = new MemoryWebhookReceiptStore();
    const store = new MemoryStore(randomUUID(), receipts);
    const task = store.seedTask({
      title: "Verify",
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
    return { store, task, receipts };
  }

  function webhook(taskId: string, deliveryId: string) {
    const body = JSON.stringify({
      action: "opened",
      pull_request: {
        number: 9,
        title: "ok",
        html_url: "https://github.com/jordymekerss-source/nexora/pull/9",
        body: nadsTaskMarker(taskId),
        head: { ref: `${nadsBranchPrefix(taskId)}-x`, sha: "abc" },
      },
    });
    return {
      body,
      verified: verifyGitHubWebhookSignature(
        body,
        {
          "x-hub-signature-256": sign(body, "s"),
          "x-github-delivery": deliveryId,
          "x-github-event": "pull_request",
        },
        { secret: "s" },
      ),
    };
  }

  it("rejects wrong repository", async () => {
    const { store, task, receipts } = await prepare();
    const { body, verified } = webhook(task.id, "wrong-repo");
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github: {
        async createBranch() {},
        async listOpenPullRequests() {
          return [];
        },
        async createPullRequest() {
          throw new Error("unused");
        },
        async getCheckConclusions() {
          return [];
        },
        async branchExists() {
          return true;
        },
        async verifyTaskPullRequest() {
          return {
            ok: false,
            branchExists: true,
            prFound: true,
            markerPresent: true,
            repositoryMatch: false,
            notMerged: true,
            draft: true,
            prNumber: 9,
            prUrl: null,
            headBranch: null,
            headSha: null,
            checks: [],
            errors: ["repository_mismatch: adapter evil/other ≠ expected jordymekerss-source/nexora"],
          };
        },
      },
      verified,
      receipts,
      rawBody: body,
    });
    expect(outcome.handled).toBe(false);
    expect(outcome.reason).toMatch(/pr_verification_failed|repository_mismatch/);
    expect(store.tasks[0]?.status).toBe("AGENT_RUNNING");
  });

  it("rejects wrong task marker", async () => {
    const { store, task, receipts } = await prepare();
    const { body, verified } = webhook(task.id, "wrong-marker");
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github: {
        async createBranch() {},
        async listOpenPullRequests() {
          return [];
        },
        async createPullRequest() {
          throw new Error("unused");
        },
        async getCheckConclusions() {
          return [];
        },
        async branchExists() {
          return true;
        },
        async verifyTaskPullRequest() {
          return {
            ok: false,
            branchExists: true,
            prFound: true,
            markerPresent: false,
            repositoryMatch: true,
            notMerged: true,
            draft: true,
            prNumber: 9,
            prUrl: null,
            headBranch: `${nadsBranchPrefix(task.id)}-x`,
            headSha: "abc",
            checks: [],
            errors: ["wrong_task_marker"],
          };
        },
      },
      verified,
      receipts,
      rawBody: body,
    });
    expect(outcome.reason).toMatch(/wrong_task_marker|pr_verification_failed/);
    expect(await receipts.getCompletionLease?.(store.projectId, task.id)).toBeNull();
  });

  it("rejects wrong branch prefix", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/pulls/9")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            number: 9,
            title: "t",
            html_url: "https://github.com/jordymekerss-source/nexora/pull/9",
            merged_at: null,
            body: nadsTaskMarker("11111111-1111-4111-8111-111111111111"),
            state: "open",
            draft: true,
            head: { ref: "cursor/evil-branch", sha: "deadbeef" },
            base: { ref: "main" },
          }),
          text: async () => "",
        };
      }
      if (String(url).includes("/git/ref/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: "deadbeef" } }),
          text: async () => "",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [] }),
        text: async () => "",
      };
    });
    const adapter = new HttpGitHubAdapter({
      token: "t",
      owner: "jordymekerss-source",
      repo: "nexora",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.verifyTaskPullRequest({
      taskId: "11111111-1111-4111-8111-111111111111",
      taskMarker: nadsTaskMarker("11111111-1111-4111-8111-111111111111"),
      expectedOwner: "jordymekerss-source",
      expectedRepo: "nexora",
      prNumber: 9,
      expectedBranchPrefix: nadsBranchPrefix("11111111-1111-4111-8111-111111111111"),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("wrong_branch_prefix"))).toBe(true);
  });

  it("rejects spoofed marker (title only, missing body)", async () => {
    const taskId = "11111111-1111-4111-8111-111111111111";
    const marker = nadsTaskMarker(taskId);
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/pulls/9")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            number: 9,
            title: `fix ${marker}`,
            html_url: "https://github.com/jordymekerss-source/nexora/pull/9",
            merged_at: null,
            body: "no real correlation",
            state: "open",
            draft: true,
            head: { ref: `${nadsBranchPrefix(taskId)}-x`, sha: "deadbeef" },
            base: { ref: "main" },
          }),
          text: async () => "",
        };
      }
      if (String(url).includes("/git/ref/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: "deadbeef" } }),
          text: async () => "",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [] }),
        text: async () => "",
      };
    });
    const adapter = new HttpGitHubAdapter({
      token: "t",
      owner: "jordymekerss-source",
      repo: "nexora",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.verifyTaskPullRequest({
      taskId,
      taskMarker: marker,
      expectedOwner: "jordymekerss-source",
      expectedRepo: "nexora",
      prNumber: 9,
      expectedBranchPrefix: nadsBranchPrefix(taskId),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("spoofed_marker"))).toBe(true);
  });

  it("rejects merged PR", async () => {
    const taskId = "11111111-1111-4111-8111-111111111111";
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/pulls/9")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            number: 9,
            title: "t",
            html_url: "https://github.com/jordymekerss-source/nexora/pull/9",
            merged_at: "2026-01-01T00:00:00Z",
            body: nadsTaskMarker(taskId),
            state: "closed",
            draft: false,
            head: { ref: `${nadsBranchPrefix(taskId)}-x`, sha: "deadbeef" },
            base: { ref: "main" },
          }),
          text: async () => "",
        };
      }
      if (String(url).includes("/git/ref/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: "deadbeef" } }),
          text: async () => "",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [] }),
        text: async () => "",
      };
    });
    const adapter = new HttpGitHubAdapter({
      token: "t",
      owner: "jordymekerss-source",
      repo: "nexora",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.verifyTaskPullRequest({
      taskId,
      taskMarker: nadsTaskMarker(taskId),
      expectedOwner: "jordymekerss-source",
      expectedRepo: "nexora",
      prNumber: 9,
      expectedBranchPrefix: nadsBranchPrefix(taskId),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("pull_request_merged"))).toBe(true);
  });

  it("rejects missing branch", async () => {
    const taskId = "11111111-1111-4111-8111-111111111111";
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/pulls/9")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            number: 9,
            title: "t",
            html_url: "https://github.com/jordymekerss-source/nexora/pull/9",
            merged_at: null,
            body: nadsTaskMarker(taskId),
            state: "open",
            draft: true,
            head: { ref: `${nadsBranchPrefix(taskId)}-x`, sha: "deadbeef" },
            base: { ref: "main" },
          }),
          text: async () => "",
        };
      }
      if (String(url).includes("/git/ref/")) {
        return { ok: false, status: 404, text: async () => "Not Found", json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [] }),
        text: async () => "",
      };
    });
    const adapter = new HttpGitHubAdapter({
      token: "t",
      owner: "jordymekerss-source",
      repo: "nexora",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.verifyTaskPullRequest({
      taskId,
      taskMarker: nadsTaskMarker(taskId),
      expectedOwner: "jordymekerss-source",
      expectedRepo: "nexora",
      prNumber: 9,
      expectedBranchPrefix: nadsBranchPrefix(taskId),
    });
    expect(result.ok).toBe(false);
    expect(result.branchExists).toBe(false);
    expect(result.errors.some((e) => e.startsWith("branch_missing:"))).toBe(true);
  });

  it("accepts valid matching PR", async () => {
    const taskId = "11111111-1111-4111-8111-111111111111";
    const prefix = nadsBranchPrefix(taskId);
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/pulls/9")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            number: 9,
            title: "t",
            html_url: "https://github.com/jordymekerss-source/nexora/pull/9",
            merged_at: null,
            body: `Work for ${nadsTaskMarker(taskId)}`,
            state: "open",
            draft: true,
            head: { ref: `${prefix}-feature`, sha: "deadbeef" },
            base: { ref: "main" },
          }),
          text: async () => "",
        };
      }
      if (String(url).includes("/git/ref/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ object: { sha: "deadbeef" } }),
          text: async () => "",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ check_runs: [{ name: "ci", conclusion: "success" }] }),
        text: async () => "",
      };
    });
    const adapter = new HttpGitHubAdapter({
      token: "t",
      owner: "jordymekerss-source",
      repo: "nexora",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.verifyTaskPullRequest({
      taskId,
      taskMarker: nadsTaskMarker(taskId),
      expectedOwner: "jordymekerss-source",
      expectedRepo: "nexora",
      prNumber: 9,
      expectedBranchPrefix: prefix,
    });
    expect(result.ok).toBe(true);
  });

  it("reports missing GitHub token", async () => {
    const adapter = createGitHubAdapterFromEnv({ GITHUB_TOKEN: "" });
    expect(adapter).toBeInstanceOf(UnconfiguredGitHubAdapter);
    const result = await adapter.verifyTaskPullRequest({
      taskMarker: nadsTaskMarker("11111111-1111-4111-8111-111111111111"),
      expectedOwner: "o",
      expectedRepo: "r",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_github_token");
  });

  it("wires verification into completion lifecycle (missing token)", async () => {
    const { store, task, receipts } = await prepare();
    const { body, verified } = webhook(task.id, "no-token");
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github: new UnconfiguredGitHubAdapter(),
      verified,
      receipts,
      rawBody: body,
    });
    expect(outcome.handled).toBe(false);
    expect(outcome.reason).toBe("missing_github_token");
    expect(store.events.some((e) => e.eventType === "github.pr_verification_failed")).toBe(true);
  });
});
