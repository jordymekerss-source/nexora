import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AutomationExecutor } from "../src/adapters/automation-executor.js";
import {
  AutomationDispatchPayloadSchema,
  nadsTaskMarker,
} from "../src/contracts/automation-payload.js";
import { MemoryStore } from "../src/db/memory-store.js";
import {
  FileOneShotDispatchGate,
  MemoryOneShotDispatchGate,
} from "../src/db/one-shot-gate.js";
import { dispatchAutomationTask } from "../src/orchestrator/automation-lifecycle.js";

const samplePayload = (taskId: string) =>
  AutomationDispatchPayloadSchema.parse({
    schemaVersion: 1,
    taskId,
    title: "t",
    prompt: "do the thing",
    acceptanceCriteria: ["a"],
    attempt: 1,
    maxAttempts: 3,
    correlation: {
      nadsTaskMarker: nadsTaskMarker(taskId),
      branchPrefix: "cursor/nads-x",
    },
    priorRejection: null,
    requiredChanges: [],
    repoUrl: "https://github.com/jordymekerss-source/nexora",
    startingRef: "main",
    dispatchedAt: new Date().toISOString(),
    idempotencyKey: `dispatch:${taskId}:1`,
  });

function liveEnv(taskId: string) {
  return {
    NADS_SINGLE_TASK_MODE: "true",
    NADS_APPROVED_TASK_ID: taskId,
    NADS_AUTOMATION_ENABLED: "true",
    NADS_AUTOMATION_WEBHOOK_URL: "https://example.test/hook",
    NADS_AUTOMATION_WEBHOOK_KEY: "secret",
  };
}

function wrapExecutor(inner: AutomationExecutor) {
  return {
    kind: "automation" as const,
    dispatch: (input: { payload: ReturnType<typeof samplePayload> }) =>
      inner.dispatch(input.payload),
  };
}

describe("one-shot dispatch gate", () => {
  it("atomic consume allows only one winner under concurrent tryConsume", async () => {
    const gate = new MemoryOneShotDispatchGate();
    const taskId = randomUUID();
    await gate.arm(taskId);
    const [a, b, c] = await Promise.all([
      gate.tryConsume({ taskId, consumer: "w1" }),
      gate.tryConsume({ taskId, consumer: "w2" }),
      gate.tryConsume({ taskId, consumer: "w3" }),
    ]);
    const wins = [a, b, c].filter((row) => row.ok);
    const losses = [a, b, c].filter((row) => !row.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(2);
    for (const loss of losses) {
      if (!loss.ok) expect(loss.reason).toBe("already_consumed");
    }
  });

  it("rejects wrong task id under single-task mode without consuming", async () => {
    const store = new MemoryStore();
    const approved = randomUUID();
    const other = store.seedTask({ title: "other", acceptanceCriteria: ["a"] });
    const gate = new MemoryOneShotDispatchGate();
    await gate.arm(approved);
    const fetchImpl = vi.fn();
    const inner = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const outcome = await dispatchAutomationTask({
      store,
      executor: wrapExecutor(inner),
      taskId: other.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: {
        ...liveEnv(approved),
      },
    });
    expect(outcome.status).toBe("single_task_rejected");
    expect(outcome.sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await gate.get())?.status).toBe("armed");
  });

  it("blocks concurrent live dispatch attempts so only one HTTP POST is sent", async () => {
    const taskId = randomUUID();
    const storeA = new MemoryStore();
    const storeB = new MemoryStore();
    storeA.seedTask({ id: taskId, title: "one", acceptanceCriteria: ["a"] });
    storeB.seedTask({ id: taskId, title: "one", acceptanceCriteria: ["a"] });
    const gate = new MemoryOneShotDispatchGate();
    await gate.arm(taskId);

    let releaseFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      releaseFetch();
      await new Promise((r) => setTimeout(r, 30));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "run-1" }),
      };
    });
    const inner = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const env = liveEnv(taskId);
    const wrapped = wrapExecutor(inner);

    const p1 = dispatchAutomationTask({
      store: storeA,
      executor: wrapped,
      taskId,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: env,
    });
    // Ensure first dispatch has crossed into network send (gate consumed) before second starts racing.
    await fetchStarted;
    const p2 = dispatchAutomationTask({
      store: storeB,
      executor: wrapped,
      taskId,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: env,
    });
    const [first, second] = await Promise.all([p1, p2]);
    const sentCount = [first, second].filter((row) => row.sent).length;
    const blocked = [first, second].find((row) => !row.sent);
    expect(sentCount).toBe(1);
    expect(blocked?.status).toBe("one_shot_already_consumed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await gate.get())?.status).toBe("consumed");
  });

  it("consumes gate on live send and blocks second send after consume", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({ title: "one", acceptanceCriteria: ["a"] });
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
    const env = liveEnv(task.id);
    const wrapped = wrapExecutor(inner);
    const first = await dispatchAutomationTask({
      store,
      executor: wrapped,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: env,
    });
    expect(first.sent).toBe(true);
    expect((await gate.get())?.status).toBe("consumed");

    store.tasks[0]!.status = "REVISION_REQUIRED";
    store.tasks[0]!.dispatchUncertain = false;
    store.tasks[0]!.dispatchIdempotencyKey = undefined;
    store.tasks[0]!.retryCount += 1; // new attempt key so gate (not idempotency) is the blocker
    const second = await dispatchAutomationTask({
      store,
      executor: wrapped,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: env,
    });
    expect(second.sent).toBe(false);
    expect(second.status).toBe("one_shot_already_consumed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not consume gate when Automation send is disabled", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({ title: "dry", acceptanceCriteria: ["a"] });
    const gate = new MemoryOneShotDispatchGate();
    await gate.arm(task.id);
    const fetchImpl = vi.fn();
    const inner = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const outcome = await dispatchAutomationTask({
      store,
      executor: wrapExecutor(inner),
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: {
        ...liveEnv(task.id),
        NADS_AUTOMATION_ENABLED: "false",
      },
    });
    expect(outcome.status).toBe("disabled");
    expect((await gate.get())?.status).toBe("armed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("file gate survives restart — consumed approval is not restored", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nads-oneshot-"));
    const filePath = path.join(dir, "one-shot-gate.json");
    try {
      const taskId = randomUUID();
      const gate1 = new FileOneShotDispatchGate(filePath);
      await gate1.arm(taskId);
      const consumed = await gate1.tryConsume({ taskId, consumer: "worker-a" });
      expect(consumed.ok).toBe(true);

      // Simulate process restart: new gate instance, same durable file.
      const gate2 = new FileOneShotDispatchGate(filePath);
      const afterRestart = await gate2.get();
      expect(afterRestart?.status).toBe("consumed");
      const blocked = await gate2.tryConsume({ taskId, consumer: "worker-b" });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.reason).toBe("already_consumed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("timeout / uncertain dispatch consumes gate and never auto-resends", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({ title: "timeout", acceptanceCriteria: ["a"] });
    const gate = new MemoryOneShotDispatchGate();
    await gate.arm(task.id);

    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          if (signal.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );
    const inner = new AutomationExecutor({
      webhookUrl: "https://example.test/hook",
      webhookKey: "secret",
      enabled: true,
      timeoutMs: 40,
      maxRetries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async () => undefined,
    });
    const env = liveEnv(task.id);
    const wrapped = wrapExecutor(inner);
    const first = await dispatchAutomationTask({
      store,
      executor: wrapped,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: env,
    });
    expect(first.uncertain).toBe(true);
    expect(first.status).toBe("ambiguous_timeout");
    expect((await gate.get())?.status).toBe("consumed");

    // Uncertain path blocks before gate — no second POST without reconcile + explicit rearm.
    const blockedUncertain = await dispatchAutomationTask({
      store,
      executor: wrapped,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: env,
    });
    expect(blockedUncertain.sent).toBe(false);
    expect(blockedUncertain.status).toBe("uncertain_requires_reconcile");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Even after clearing uncertain flag, consumed gate still blocks until explicit rearm.
    store.tasks[0]!.status = "REVISION_REQUIRED";
    store.tasks[0]!.dispatchUncertain = false;
    store.tasks[0]!.dispatchReconcileToken = undefined;
    store.tasks[0]!.dispatchIdempotencyKey = undefined;
    store.tasks[0]!.retryCount += 1; // new attempt key so gate (not idempotency) is the blocker
    const blockedGate = await dispatchAutomationTask({
      store,
      executor: wrapped,
      taskId: task.id,
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      oneShotGate: gate,
      singleTaskEnv: env,
    });
    expect(blockedGate.sent).toBe(false);
    expect(blockedGate.status).toBe("one_shot_already_consumed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await gate.rearm(task.id);
    expect((await gate.get())?.status).toBe("armed");
  });

  it("requires explicit rearm after consume (uncertain cannot auto-resend)", async () => {
    const gate = new MemoryOneShotDispatchGate();
    const taskId = randomUUID();
    await gate.arm(taskId);
    await gate.tryConsume({ taskId, consumer: "w" });
    const blocked = await gate.tryConsume({ taskId, consumer: "w2" });
    expect(blocked.ok).toBe(false);
    await gate.rearm(taskId);
    const again = await gate.tryConsume({ taskId, consumer: "w3" });
    expect(again.ok).toBe(true);
  });
});
