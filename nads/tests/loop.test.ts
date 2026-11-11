import { describe, expect, it } from "vitest";
import { MockCursorAgentProvider } from "../src/adapters/mock-cursor-adapter.js";
import { HeuristicReviewer } from "../src/adapters/openai-reviewer.js";
import { MemoryStore } from "../src/db/memory-store.js";
import { runTaskLoop } from "../src/orchestrator/loop.js";

describe("autonomous loop (mock)", () => {
  it("rejects first mock implant then accepts recovery", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({
      title: "Demo recovery loop",
      description: "Prove REJECT → recovery → ACCEPT",
      acceptanceCriteria: ["Recover from planted failure"],
      maxRetries: 3,
    });

    const result = await runTaskLoop({
      store,
      cursor: new MockCursorAgentProvider(),
      reviewer: new HeuristicReviewer(),
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      taskId: task.id,
    });

    expect(result.decisions[0]).toBe("REJECT");
    expect(result.decisions.at(-1)).toBe("ACCEPT");
    expect(result.finalStatus).toBe("NEXT_TASK");
    expect(result.iterations).toBeGreaterThanOrEqual(2);
  });

  it("refuses to start when emergency stop is on", async () => {
    const store = new MemoryStore();
    store.settings.emergencyStop = true;
    const task = store.seedTask({ title: "Blocked" });
    await expect(
      runTaskLoop({
        store,
        cursor: new MockCursorAgentProvider(),
        reviewer: new HeuristicReviewer(),
        repoUrl: "https://github.com/jordymekerss-source/nexora",
        taskId: task.id,
      }),
    ).rejects.toThrow(/Emergency stop/);
  });

  it("deduplicates events by idempotency key", () => {
    const store = new MemoryStore();
    const first = store.appendEvent({
      eventType: "webhook.test",
      payload: { n: 1 },
      idempotencyKey: "same-key",
    });
    const second = store.appendEvent({
      eventType: "webhook.test",
      payload: { n: 2 },
      idempotencyKey: "same-key",
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(store.events).toHaveLength(1);
  });
});
