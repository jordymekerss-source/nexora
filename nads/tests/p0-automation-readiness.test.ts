import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AutomationExecutor } from "../src/adapters/automation-executor.js";
import {
  HttpGitHubAdapter,
  UnconfiguredGitHubAdapter,
  createGitHubAdapterFromEnv,
} from "../src/adapters/github-adapter.js";
import {
  AutomationDispatchPayloadSchema,
  buildAutomationComposerContext,
  buildAutomationWebhookBody,
  nadsTaskMarker,
} from "../src/contracts/automation-payload.js";
import { MemoryStore } from "../src/db/memory-store.js";
import {
  FileWebhookReceiptStore,
  MemoryWebhookReceiptStore,
} from "../src/db/webhook-receipts.js";
import { createNadsIngressServer } from "../src/ingress/http-server.js";
import { verifyGitHubWebhookSignature } from "../src/ingress/github-webhook.js";
import { HeuristicReviewer } from "../src/adapters/openai-reviewer.js";
import {
  completeAutomationTaskFromGitHub,
  dispatchAutomationTask,
} from "../src/orchestrator/automation-lifecycle.js";
import { createExecutorFromEnv } from "../src/adapters/executor.js";
import type { GitHubAdapter } from "../src/adapters/github-adapter.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

const samplePayload = () =>
  AutomationDispatchPayloadSchema.parse({
    schemaVersion: 1,
    taskId: "11111111-1111-4111-8111-111111111111",
    title: "Verify signup lock",
    prompt: "Implement privilege lock docs",
    acceptanceCriteria: ["No metadata role escalation"],
    attempt: 1,
    maxAttempts: 3,
    correlation: {
      nadsTaskMarker: nadsTaskMarker("11111111-1111-4111-8111-111111111111"),
      branchPrefix: "cursor/nads-1111111111",
    },
    priorRejection: null,
    requiredChanges: [],
    repoUrl: "https://github.com/jordymekerss-source/nexora",
    startingRef: "main",
    dispatchedAt: new Date().toISOString(),
    idempotencyKey: "dispatch:11111111-1111-4111-8111-111111111111:1",
  });

function mockGithub(taskId: string): GitHubAdapter {
  return {
    async createBranch() {},
    async listOpenPullRequests() {
      return [];
    },
    async createPullRequest() {
      return {
        number: 7,
        title: "ok",
        headRef: "cursor/nads-x",
        baseRef: "main",
        url: "https://github.com/o/r/pull/7",
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
        headRef: "cursor/nads-x",
        baseRef: "main",
        url: "https://github.com/o/r/pull/7",
        merged: false,
        body: `nads-task:${taskId}`,
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
        prUrl: "https://github.com/o/r/pull/7",
        headBranch: "cursor/nads-x",
        headSha: "abc",
        checks: [],
        errors: [],
      };
    },
  };
}

describe("P0 payload-to-prompt bridge", () => {
  it("maps structured payload into Automation context brief", () => {
    const payload = samplePayload();
    const body = buildAutomationWebhookBody(payload);
    expect(body.context).toContain(payload.taskId);
    expect(body.context).toContain(payload.title);
    expect(body.context).toContain(payload.repoUrl);
    expect(body.context).toContain(payload.startingRef);
    expect(body.context).toContain(payload.correlation.branchPrefix);
    expect(body.context).toContain(payload.correlation.nadsTaskMarker);
    expect(body.context).toContain("Acceptance criteria");
    expect(body.context).toContain("draft");
    expect(body.nads.taskId).toBe(payload.taskId);
    expect(buildAutomationComposerContext(payload)).toContain("Safety rules");
  });
});

describe("P0 AutomationExecutor reliability", () => {
  it("times out without retrying ambiguous AbortError", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const executor = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: true,
      timeoutMs: 40,
      maxRetries: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });
    const result = await executor.dispatch(samplePayload());
    expect(result.status).toBe("ambiguous_timeout");
    expect(result.sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  }, 5000);

  it("retries transient HTTP 503 then succeeds once", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "busy",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "run-ok" }),
      });
    const executor = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: true,
      maxRetries: 2,
      backoffMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });
    const result = await executor.dispatch(samplePayload());
    expect(result.status).toBe("dispatched");
    expect(result.executionId).toBe("run-ok");
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.context).toContain("NADS Automation task brief");
    expect(body.nads.idempotencyKey).toBe(samplePayload().idempotencyKey);
  });

  it("does not retry authentication failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "nope",
    });
    const executor = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "bad",
      enabled: true,
      maxRetries: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await executor.dispatch(samplePayload());
    expect(result.status).toBe("auth_error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("P0 webhook receipts + concurrent completion", () => {
  it("persists duplicate delivery claims in file store", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nads-receipts-"));
    const store = new FileWebhookReceiptStore(path.join(dir, "receipts.json"));
    const first = await store.tryClaim({
      projectId: "p1",
      provider: "github",
      deliveryId: "d1",
      eventType: "pull_request:opened",
      taskId: "11111111-1111-4111-8111-111111111111",
    });
    const second = await store.tryClaim({
      projectId: "p1",
      provider: "github",
      deliveryId: "d1",
      eventType: "pull_request:opened",
    });
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.reason).toBe("duplicate");
    await rm(dir, { recursive: true, force: true });
  });

  it("prevents concurrent distinct deliveries from double-completing one task", async () => {
    const store = new MemoryStore();
    const receipts = new MemoryWebhookReceiptStore();
    const task = store.seedTask({
      title: "Concurrent",
      description: "demo",
      acceptanceCriteria: ["Recover from planted failure"],
    });
    const executor = createExecutorFromEnv({
      NADS_EXECUTOR: "automation",
      NADS_AUTOMATION_ENABLED: "false",
    });
    await dispatchAutomationTask({
      store,
      executor,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      receipts,
    });

    const secret = "whsec";
    const mkVerified = (deliveryId: string) => {
      const body = JSON.stringify({
        action: "opened",
        pull_request: {
          number: 7,
          title: "ok",
          html_url: "https://github.com/o/r/pull/7",
          body: `nads-task:${task.id}`,
          head: { ref: "cursor/nads-x", sha: "abc" },
        },
      });
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
    };

    const a = mkVerified("deliv-a");
    const b = mkVerified("deliv-b");
    const github = mockGithub(task.id);

    const [one, two] = await Promise.all([
      completeAutomationTaskFromGitHub({
        store,
        reviewer: new HeuristicReviewer(),
        github,
        verified: a.verified,
        receipts,
        rawBody: a.body,
      }),
      completeAutomationTaskFromGitHub({
        store,
        reviewer: new HeuristicReviewer(),
        github,
        verified: b.verified,
        receipts,
        rawBody: b.body,
      }),
    ]);

    const handled = [one, two].filter((row) => row.handled);
    const dupes = [one, two].filter((row) => row.reason === "duplicate_completion");
    expect(handled).toHaveLength(1);
    expect(dupes).toHaveLength(1);
    expect(store.tasks[0]?.status).toBe("NEXT_TASK");
  });

  it("rejects invalid task correlation", async () => {
    const store = new MemoryStore();
    const receipts = new MemoryWebhookReceiptStore();
    const body = JSON.stringify({
      action: "opened",
      pull_request: {
        number: 1,
        title: "x",
        html_url: "https://github.com/o/r/pull/1",
        body: "no marker",
        head: { ref: "feature" },
      },
    });
    const secret = "s";
    const verified = verifyGitHubWebhookSignature(
      body,
      {
        "x-hub-signature-256": sign(body, secret),
        "x-github-delivery": "d-miss",
        "x-github-event": "pull_request",
      },
      { secret },
    );
    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github: mockGithub("11111111-1111-4111-8111-111111111111"),
      verified,
      receipts,
      rawBody: body,
    });
    expect(outcome.handled).toBe(false);
    expect(outcome.reason).toBe("missing_task_correlation");
  });
});

describe("P0 GitHub verification", () => {
  it("fails closed when GITHUB_TOKEN missing", async () => {
    const adapter = createGitHubAdapterFromEnv({ GITHUB_TOKEN: "" });
    expect(adapter).toBeInstanceOf(UnconfiguredGitHubAdapter);
    await expect(adapter.branchExists("cursor/x")).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(
      adapter.verifyTaskPullRequest({
        taskMarker: "nads-task:11111111-1111-4111-8111-111111111111",
        expectedOwner: "o",
        expectedRepo: "r",
      }),
    ).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it("branchExists returns false on 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found",
      json: async () => ({}),
    });
    const adapter = new HttpGitHubAdapter({
      token: "t",
      owner: "o",
      repo: "r",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.branchExists("missing")).resolves.toBe(false);
  });

  it("verifyTaskPullRequest checks marker, repo, merge state", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("/pulls/9")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            number: 9,
            title: "t",
            html_url: "https://github.com/o/r/pull/9",
            merged_at: null,
            body: "nads-task:11111111-1111-4111-8111-111111111111",
            state: "open",
            draft: true,
            head: { ref: "cursor/nads-1111111111-x", sha: "deadbeef" },
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
      if (String(url).includes("/check-runs")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ check_runs: [{ name: "ci", conclusion: "success" }] }),
          text: async () => "",
        };
      }
      return { ok: false, status: 500, text: async () => "nope", json: async () => ({}) };
    });
    const adapter = new HttpGitHubAdapter({
      token: "t",
      owner: "o",
      repo: "r",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.verifyTaskPullRequest({
      taskMarker: "nads-task:11111111-1111-4111-8111-111111111111",
      expectedOwner: "o",
      expectedRepo: "r",
      prNumber: 9,
    });
    expect(result.ok).toBe(true);
    expect(result.markerPresent).toBe(true);
    expect(result.repositoryMatch).toBe(true);
    expect(result.notMerged).toBe(true);
    expect(result.branchExists).toBe(true);
  });
});

describe("P0 HTTP ingress", () => {
  it("serves health and rejects bad GitHub signatures", async () => {
    const store = new MemoryStore();
    const receipts = new MemoryWebhookReceiptStore();
    const server = createNadsIngressServer({
      store,
      github: mockGithub("11111111-1111-4111-8111-111111111111"),
      reviewer: new HeuristicReviewer(),
      receipts,
      githubWebhookSecret: "whsec",
      maxBodyBytes: 1024,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).ok).toBe(true);

    const bad = await fetch(`${base}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-delivery": "x",
        "x-github-event": "pull_request",
      },
      body: JSON.stringify({ action: "opened" }),
    });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toBe("invalid_signature");

    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("accepts valid signature and enforces duplicate delivery", async () => {
    const store = new MemoryStore();
    const receipts = new MemoryWebhookReceiptStore();
    const task = store.seedTask({
      title: "Ingress",
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

    const server = createNadsIngressServer({
      store,
      github: mockGithub(task.id),
      reviewer: new HeuristicReviewer(),
      receipts,
      githubWebhookSecret: "whsec",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${address.port}`;
    const body = JSON.stringify({
      action: "opened",
      pull_request: {
        number: 7,
        title: "ok",
        html_url: "https://github.com/o/r/pull/7",
        body: `nads-task:${task.id}`,
        head: { ref: "cursor/nads-x", sha: "abc" },
      },
    });
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": sign(body, "whsec"),
      "x-github-delivery": "ingress-1",
      "x-github-event": "pull_request",
    };
    const first = await fetch(`${base}/webhooks/github`, { method: "POST", headers, body });
    expect(first.status).toBe(200);
    expect((await first.json()).handled).toBe(true);

    const second = await fetch(`${base}/webhooks/github`, { method: "POST", headers, body });
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as { handled: boolean; reason: string };
    expect(secondJson.handled).toBe(false);
    expect(secondJson.reason).toBe("duplicate_delivery");

    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});
