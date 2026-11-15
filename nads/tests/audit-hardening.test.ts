import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AutomationExecutor } from "../src/adapters/automation-executor.js";
import {
  AutomationDispatchPayloadSchema,
  nadsTaskMarker,
} from "../src/contracts/automation-payload.js";
import { assertProductionPersistenceConfig } from "../src/config/production-guards.js";
import { MemoryStore } from "../src/db/memory-store.js";
import { MemoryOneShotDispatchGate } from "../src/db/one-shot-gate.js";
import { MemoryWebhookReceiptStore } from "../src/db/webhook-receipts.js";
import { createNadsIngressServer } from "../src/ingress/http-server.js";
import { HeuristicReviewer } from "../src/adapters/openai-reviewer.js";
import { UnconfiguredGitHubAdapter } from "../src/adapters/github-adapter.js";
import { dispatchAutomationTask } from "../src/orchestrator/automation-lifecycle.js";

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function wrapExecutor(inner: AutomationExecutor) {
  return {
    kind: "automation" as const,
    dispatch: (input: { payload: ReturnType<typeof AutomationDispatchPayloadSchema.parse> }) =>
      inner.dispatch(input.payload),
  };
}

describe("audit hardening: health automationSend", () => {
  it("reports automationSend from options (false)", async () => {
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
    expect(health.status).toBe(200);
    expect((await health.json()).automationSend).toBe(false);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("reports automationSend true when enabled", async () => {
    const server = createNadsIngressServer({
      store: new MemoryStore(),
      github: new UnconfiguredGitHubAdapter(),
      reviewer: new HeuristicReviewer(),
      receipts: new MemoryWebhookReceiptStore(),
      githubWebhookSecret: "whsec",
      automationSendEnabled: true,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect((await health.json()).automationSend).toBe(true);
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("/ready returns 503 when readyCheck fails", async () => {
    const server = createNadsIngressServer({
      store: new MemoryStore(),
      github: new UnconfiguredGitHubAdapter(),
      reviewer: new HeuristicReviewer(),
      receipts: new MemoryWebhookReceiptStore(),
      githubWebhookSecret: "whsec",
      readyCheck: async () => false,
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
});

describe("audit hardening: in-process replay 409", () => {
  it("returns 409 replay for same-process duplicate delivery before receipt path", async () => {
    const store = new MemoryStore();
    const receipts = new MemoryWebhookReceiptStore();
    const task = store.seedTask({
      title: "replay",
      acceptanceCriteria: ["a"],
      status: "AGENT_RUNNING",
    });
    const server = createNadsIngressServer({
      store,
      github: new UnconfiguredGitHubAdapter(),
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
      "x-github-delivery": "same-proc-1",
      "x-github-event": "pull_request",
    };
    const first = await fetch(`${base}/webhooks/github`, { method: "POST", headers, body });
    expect(first.status).toBe(200);
    const second = await fetch(`${base}/webhooks/github`, { method: "POST", headers, body });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("replay");
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});

describe("audit hardening: one-shot without single-task mode", () => {
  it("still consumes one-shot gate when NADS_SINGLE_TASK_MODE is false", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({ title: "send", acceptanceCriteria: ["a"] });
    const gate = new MemoryOneShotDispatchGate();
    await gate.arm(task.id);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "run-1" }),
    });
    const inner = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const first = await dispatchAutomationTask({
      store,
      executor: wrapExecutor(inner),
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: {
        NADS_SINGLE_TASK_MODE: "false",
        NADS_AUTOMATION_ENABLED: "true",
        NADS_AUTOMATION_WEBHOOK_URL: "https://example.test/hook",
        NADS_AUTOMATION_WEBHOOK_KEY: "secret",
      },
    });
    expect(first.sent).toBe(true);
    expect((await gate.get())?.status).toBe("consumed");

    store.tasks[0]!.status = "REVISION_REQUIRED";
    store.tasks[0]!.dispatchUncertain = false;
    store.tasks[0]!.dispatchIdempotencyKey = undefined;
    store.tasks[0]!.retryCount += 1;
    const second = await dispatchAutomationTask({
      store,
      executor: wrapExecutor(inner),
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: {
        NADS_SINGLE_TASK_MODE: "false",
        NADS_AUTOMATION_ENABLED: "true",
        NADS_AUTOMATION_WEBHOOK_URL: "https://example.test/hook",
        NADS_AUTOMATION_WEBHOOK_KEY: "secret",
      },
    });
    expect(second.sent).toBe(false);
    expect(second.status).toBe("one_shot_already_consumed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("audit hardening: production send guards", () => {
  it("refuses Automation enabled without single-task + postgres gate", () => {
    expect(() =>
      assertProductionPersistenceConfig({
        NADS_PRODUCTION: "true",
        NADS_WEBHOOK_RECEIPT_STORE: "postgres",
        NADS_DISPATCH_STATE_STORE: "postgres",
        DATABASE_URL: "postgresql://nads:nads@localhost:5432/nads",
        NADS_AUTOMATION_ENABLED: "true",
        NADS_SINGLE_TASK_MODE: "false",
      }),
    ).toThrow(/NADS_SINGLE_TASK_MODE/);
  });

  it("refuses Automation enabled without approved task id", () => {
    expect(() =>
      assertProductionPersistenceConfig({
        NADS_PRODUCTION: "true",
        NADS_WEBHOOK_RECEIPT_STORE: "postgres",
        NADS_DISPATCH_STATE_STORE: "postgres",
        DATABASE_URL: "postgresql://nads:nads@localhost:5432/nads",
        NADS_AUTOMATION_ENABLED: "true",
        NADS_SINGLE_TASK_MODE: "true",
        NADS_ONE_SHOT_GATE_STORE: "postgres",
      }),
    ).toThrow(/NADS_APPROVED_TASK_ID/);
  });

  it("accepts Automation enabled with single-task + postgres gate", () => {
    expect(() =>
      assertProductionPersistenceConfig({
        NADS_PRODUCTION: "true",
        NADS_WEBHOOK_RECEIPT_STORE: "postgres",
        NADS_DISPATCH_STATE_STORE: "postgres",
        DATABASE_URL: "postgresql://nads:nads@localhost:5432/nads",
        NADS_AUTOMATION_ENABLED: "true",
        NADS_SINGLE_TASK_MODE: "true",
        NADS_APPROVED_TASK_ID: randomUUID(),
        NADS_ONE_SHOT_GATE_STORE: "postgres",
      }),
    ).not.toThrow();
  });
});

describe("audit hardening: empty store task_not_found", () => {
  it("returns task_not_found when ingress store has no matching task", async () => {
    const store = new MemoryStore();
    const receipts = new MemoryWebhookReceiptStore();
    const missingId = randomUUID();
    const server = createNadsIngressServer({
      store,
      github: new UnconfiguredGitHubAdapter(),
      reviewer: new HeuristicReviewer(),
      receipts,
      githubWebhookSecret: "whsec",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const body = JSON.stringify({
      action: "opened",
      pull_request: {
        number: 9,
        title: "t",
        html_url: "https://github.com/o/r/pull/9",
        body: `nads-task:${missingId}`,
        head: { ref: "cursor/nads-x", sha: "abc" },
      },
    });
    const res = await fetch(`http://127.0.0.1:${address.port}/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body, "whsec"),
        "x-github-delivery": "missing-task-1",
        "x-github-event": "pull_request",
      },
      body,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { handled: boolean; reason: string };
    expect(json.handled).toBe(false);
    expect(json.reason).toBe("task_not_found");
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});
