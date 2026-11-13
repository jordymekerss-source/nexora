import { describe, expect, it, vi } from "vitest";
import { AutomationExecutor } from "../src/adapters/automation-executor.js";
import {
  AutomationDispatchPayloadSchema,
  nadsTaskMarker,
} from "../src/contracts/automation-payload.js";
import { createExecutorFromEnv } from "../src/adapters/executor.js";
import { MemoryStore } from "../src/db/memory-store.js";
import { dispatchAutomationTask } from "../src/orchestrator/automation-lifecycle.js";

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

describe("AutomationExecutor", () => {
  it("validates payload but does not send when disabled (default)", async () => {
    const fetchImpl = vi.fn();
    const executor = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await executor.dispatch(samplePayload());
    expect(result.sent).toBe(false);
    expect(result.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fail-closes when enabled without credentials (no cursor fallback)", async () => {
    const executor = new AutomationExecutor({
      enabled: true,
      webhookUrl: "",
      webhookKey: "",
    });
    const result = await executor.dispatch(samplePayload());
    expect(result.ok).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.error).toMatch(/no cursor API fallback/i);
  });

  it("POSTs bearer auth when enabled and does not expose key in result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ runUuid: "run-1" }),
    });
    const executor = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "super-secret-key",
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await executor.dispatch(samplePayload());
    expect(result.sent).toBe(true);
    expect(result.executionId).toBe("run-1");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer super-secret-key");
    expect(JSON.stringify(result)).not.toContain("super-secret-key");
  });
});

describe("dispatchAutomationTask", () => {
  it("refuses cursor executor (no prepaid API path)", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({ title: "x", acceptanceCriteria: ["a"] });
    const executor = createExecutorFromEnv({
      NADS_EXECUTOR: "cursor",
      CURSOR_API_KEY: "k",
    });
    await expect(
      dispatchAutomationTask({
        store,
        executor,
        taskId: task.id,
        repoUrl: "https://github.com/jordymekerss-source/nexora",
      }),
    ).rejects.toThrow(/refuses NADS_EXECUTOR=cursor/i);
  });

  it("records disabled dispatch and leaves task AGENT_RUNNING", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({ title: "x", acceptanceCriteria: ["a"] });
    const executor = createExecutorFromEnv({
      NADS_EXECUTOR: "automation",
      NADS_AUTOMATION_ENABLED: "false",
    });
    const outcome = await dispatchAutomationTask({
      store,
      executor,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
    });
    expect(outcome.status).toBe("disabled");
    expect(store.tasks[0]?.status).toBe("AGENT_RUNNING");
    expect(store.events.some((event) => event.eventType === "automation.dispatch")).toBe(true);
  });
});
