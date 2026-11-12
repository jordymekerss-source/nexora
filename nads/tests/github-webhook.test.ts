import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GitHubWebhookError,
  isAutomationCompletionEvent,
  markGitHubDeliverySeen,
  verifyGitHubWebhookSignature,
} from "../src/ingress/github-webhook.js";
import { verifyAutomationCallback } from "../src/ingress/automation-callback.js";
import { MemoryStore } from "../src/db/memory-store.js";
import { HeuristicReviewer } from "../src/adapters/openai-reviewer.js";
import { completeAutomationTaskFromGitHub } from "../src/orchestrator/automation-lifecycle.js";
import { dispatchAutomationTask } from "../src/orchestrator/automation-lifecycle.js";
import { createExecutorFromEnv } from "../src/adapters/executor.js";
import type { GitHubAdapter } from "../src/adapters/github-adapter.js";

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyGitHubWebhookSignature", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({
    action: "opened",
    pull_request: {
      number: 42,
      title: "feat",
      html_url: "https://github.com/o/r/pull/42",
      body: "Please review nads-task:11111111-1111-4111-8111-111111111111",
      head: { ref: "cursor/nads-1111111111-x" },
    },
  });

  it("accepts valid signature and extracts task id", () => {
    const verified = verifyGitHubWebhookSignature(body, {
      "x-hub-signature-256": sign(body, secret),
      "x-github-delivery": "deliv-1",
      "x-github-event": "pull_request",
    }, { secret });
    expect(verified.taskId).toBe("11111111-1111-4111-8111-111111111111");
    expect(verified.prNumber).toBe(42);
    expect(isAutomationCompletionEvent(verified)).toBe(true);
  });

  it("rejects bad signatures", () => {
    expect(() =>
      verifyGitHubWebhookSignature(body, {
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-delivery": "deliv-2",
        "x-github-event": "pull_request",
      }, { secret }),
    ).toThrow(GitHubWebhookError);
  });

  it("rejects duplicate deliveries (replay)", () => {
    const seen = new Set<string>();
    const headers = {
      "x-hub-signature-256": sign(body, secret),
      "x-github-delivery": "deliv-3",
      "x-github-event": "pull_request",
    };
    const first = verifyGitHubWebhookSignature(body, headers, { secret, seenDeliveryIds: seen });
    markGitHubDeliverySeen(seen, first.deliveryId);
    expect(() =>
      verifyGitHubWebhookSignature(body, headers, { secret, seenDeliveryIds: seen }),
    ).toThrow(/Duplicate/);
  });
});

describe("verifyAutomationCallback", () => {
  it("verifies HMAC and schema", () => {
    const secret = "cbsec";
    const payload = {
      schemaVersion: 1,
      taskId: "11111111-1111-4111-8111-111111111111",
      executionId: "exec-1",
      status: "succeeded",
      branchName: "cursor/nads-x",
      prUrl: "https://github.com/o/r/pull/1",
      prNumber: 1,
      error: null,
      occurredAt: new Date().toISOString(),
    };
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    const parsed = verifyAutomationCallback(raw, { "x-nads-signature": sig }, { secret });
    expect(parsed.executionId).toBe("exec-1");
  });
});

describe("automation webhook execution lifecycle", () => {
  it("dispatch → github complete → review ACCEPT/REJECT path", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({
      title: "Lifecycle",
      description: "demo",
      acceptanceCriteria: ["Recover from planted failure"],
      maxRetries: 3,
    });
    // Force planted fail into agent result via reviewer heuristic on files content — use clean evidence for ACCEPT
    const executor = createExecutorFromEnv({
      NADS_EXECUTOR: "automation",
      NADS_AUTOMATION_ENABLED: "false",
    });
    await dispatchAutomationTask({
      store,
      executor,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
    });
    expect(store.tasks[0]?.status).toBe("AGENT_RUNNING");

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
    const secret = "whsec";
    const verified = verifyGitHubWebhookSignature(
      body,
      {
        "x-hub-signature-256": sign(body, secret),
        "x-github-delivery": "deliv-life-1",
        "x-github-event": "pull_request",
      },
      { secret },
    );

    const github: GitHubAdapter = {
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
          body: `nads-task:${task.id}`,
          state: "open",
          draft: true,
          headSha: "abc",
        };
      },
      async listPullRequestFiles() {
        return [
          { filename: "README.md", status: "modified", additions: 1, deletions: 0, patch: "+ok" },
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
          prUrl: "https://github.com/o/r/pull/7",
          headBranch: "cursor/nads-x",
          headSha: "abc",
          checks: [{ name: "test", conclusion: "success" }],
          errors: [],
        };
      },
    };

    const outcome = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github,
      verified,
    });
    expect(outcome.handled).toBe(true);
    expect(outcome.decision).toBe("ACCEPT");
    expect(store.tasks[0]?.status).toBe("NEXT_TASK");

    // idempotent replay of same delivery via event key
    const again = await completeAutomationTaskFromGitHub({
      store,
      reviewer: new HeuristicReviewer(),
      github,
      verified,
    });
    expect(again.reason).toBe("duplicate_delivery");
  });
});
