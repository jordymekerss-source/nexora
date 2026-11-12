import { describe, expect, it, vi } from "vitest";
import {
  AutomationExecutor,
  isPreAcceptNetworkError,
  isUncertainDispatchStatus,
} from "../src/adapters/automation-executor.js";
import {
  AutomationDispatchPayloadSchema,
  nadsTaskMarker,
} from "../src/contracts/automation-payload.js";
import { createExecutorFromEnv } from "../src/adapters/executor.js";
import { MemoryStore } from "../src/db/memory-store.js";
import {
  dispatchAutomationTask,
  reconcileUncertainDispatch,
} from "../src/orchestrator/automation-lifecycle.js";

const samplePayload = () =>
  AutomationDispatchPayloadSchema.parse({
    schemaVersion: 1,
    taskId: "11111111-1111-4111-8111-111111111111",
    title: "t",
    prompt: "do the thing",
    acceptanceCriteria: ["a"],
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

describe("P0.7.4 safe Automation POST retry policy", () => {
  it("never retries HTTP 500/502/503/504", async () => {
    for (const status of [500, 502, 503, 504]) {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: async () => "err",
      });
      const executor = new AutomationExecutor({
        webhookUrl: "https://example.test/hook",
        webhookKey: "secret",
        enabled: true,
        maxRetries: 5,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: async () => undefined,
      });
      const result = await executor.dispatch(samplePayload());
      expect(result.status).toBe("ambiguous_server_error");
      expect(result.uncertain).toBe(true);
      expect(result.sent).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("retries only pre-accept network errors then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { code: "ECONNREFUSED" }))
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry 429 (response received — not pre-accept)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "slow down",
    });
    const executor = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: true,
      maxRetries: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await executor.dispatch(samplePayload());
    expect(result.status).toBe("error");
    expect(result.httpStatus).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("marks timeout as ambiguous and never retries", async () => {
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
      timeoutMs: 30,
      maxRetries: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });
    const result = await executor.dispatch(samplePayload());
    expect(result.status).toBe("ambiguous_timeout");
    expect(result.uncertain).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("persists uncertain dispatch and blocks re-dispatch until reconcile", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({ title: "x", acceptanceCriteria: ["a"] });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
    });
    const executor = createExecutorFromEnv({
      NADS_EXECUTOR: "automation",
      NADS_AUTOMATION_ENABLED: "true",
      NADS_AUTOMATION_WEBHOOK_URL: "https://example.test/hook",
      NADS_AUTOMATION_WEBHOOK_KEY: "secret",
    });
    // Inject fetch by constructing a fresh executor wrapper is hard — use AutomationExecutor via dispatch path:
    const { AutomationExecutor: AE } = await import("../src/adapters/automation-executor.js");
    const inner = new AE({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 2,
    });
    const wrapped = {
      kind: "automation" as const,
      dispatch: (input: { payload: ReturnType<typeof samplePayload> }) => inner.dispatch(input.payload),
    };

    const first = await dispatchAutomationTask({
      store,
      executor: wrapped,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
    });
    expect(first.uncertain).toBe(true);
    expect(first.status).toBe("ambiguous_server_error");
    expect(store.tasks[0]?.dispatchUncertain).toBe(true);
    expect(store.tasks[0]?.dispatchReconcileToken).toBeTruthy();
    expect(isUncertainDispatchStatus(first.status)).toBe(true);

    const blocked = await dispatchAutomationTask({
      store,
      executor: wrapped,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
    });
    expect(blocked.status).toBe("uncertain_requires_reconcile");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const token = store.tasks[0]!.dispatchReconcileToken!;
    expect(reconcileUncertainDispatch(store, task.id, "bad-token").ok).toBe(false);
    expect(reconcileUncertainDispatch(store, task.id, token).ok).toBe(true);
    expect(store.tasks[0]?.dispatchUncertain).toBe(false);
  });

  it("classifies pre-accept network errors", () => {
    expect(isPreAcceptNetworkError(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(
      true,
    );
    expect(isPreAcceptNetworkError(new TypeError("fetch failed"))).toBe(true);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isPreAcceptNetworkError(abort)).toBe(false);
  });
});
