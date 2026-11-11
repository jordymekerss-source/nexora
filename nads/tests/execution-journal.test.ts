import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExecutionJournal, hashPrompt } from "../src/db/execution-journal.js";
import { MockCursorAgentProvider } from "../src/adapters/mock-cursor-adapter.js";
import { HeuristicReviewer } from "../src/adapters/openai-reviewer.js";
import { MemoryStore } from "../src/db/memory-store.js";
import { runTaskLoop } from "../src/orchestrator/loop.js";

describe("ExecutionJournal", () => {
  it("persists and reloads agent/run ids for restart recovery", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nads-journal-"));
    const file = path.join(dir, "execution-journal.json");
    const journal = new ExecutionJournal(file);
    await journal.upsert({
      taskId: "task-1",
      agentId: "bc-1",
      runId: "run-1",
      iteration: 1,
      status: "FINISHED",
      updatedAt: new Date().toISOString(),
    });

    const reloaded = new ExecutionJournal(file);
    await reloaded.load();
    expect(reloaded.get("task-1")?.agentId).toBe("bc-1");
    expect(reloaded.get("task-1")?.runId).toBe("run-1");

    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("CURSOR_API_KEY");
    expect(raw).not.toContain("Authorization");
    // Avoid matching substrings like "task-1" (contains "sk-1").
    expect(raw).not.toMatch(/\bsk-[a-zA-Z0-9]{10,}\b/);
  });

  it("hashPrompt is stable", () => {
    expect(hashPrompt("abc")).toBe(hashPrompt("abc"));
    expect(hashPrompt("abc")).not.toBe(hashPrompt("abcd"));
  });
});

describe("runTaskLoop restart recovery", () => {
  it("reuses journal agent id instead of creating a duplicate agent", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nads-loop-"));
    const journal = new ExecutionJournal(path.join(dir, "journal.json"));
    const store = new MemoryStore();
    const task = store.seedTask({
      title: "Recover",
      acceptanceCriteria: ["ok"],
      maxRetries: 3,
    });

    const cursor = new MockCursorAgentProvider();
    // Seed prior agent as if a previous process already created it.
    const prior = await cursor.createAgent({
      prompt: { text: "prior" },
      agentId: `bc-${task.id}`,
      name: "prior",
    });
    await journal.upsert({
      taskId: task.id,
      agentId: prior.agent.id,
      runId: prior.run.id,
      iteration: 1,
      status: "FINISHED",
      updatedAt: new Date().toISOString(),
    });

    const createSpyCalls: string[] = [];
    const originalCreate = cursor.createAgent.bind(cursor);
    cursor.createAgent = async (input) => {
      createSpyCalls.push(input.agentId ?? "none");
      return originalCreate(input);
    };

    const result = await runTaskLoop({
      store,
      cursor,
      reviewer: new HeuristicReviewer(),
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      taskId: task.id,
      journal,
    });

    expect(createSpyCalls).toHaveLength(0);
    expect(result.agentId).toBe(prior.agent.id);
    expect(result.finalStatus).toBe("NEXT_TASK");
  });

  it("blocks after maximum 3 repair attempts", async () => {
    const store = new MemoryStore();
    const task = store.seedTask({
      title: "Always reject",
      acceptanceCriteria: ["never"],
      maxRetries: 3,
    });

    const cursor = new MockCursorAgentProvider();
    // Force every result to look like planted fail by wrapping continue/create.
    const alwaysFail = async () => {
      const created = await new MockCursorAgentProvider().createAgent({
        prompt: { text: "x" },
      });
      // Ensure fail marker persists on every iteration via custom provider below.
      return created;
    };
    void alwaysFail;

    const failingCursor = {
      async createAgent() {
        return {
          agent: { id: "bc-fail", status: "ACTIVE", latestRunId: "run-1" },
          run: {
            id: "run-1",
            agentId: "bc-fail",
            status: "FINISHED",
            result: "MOCK_IMPLANT_FAIL forever",
          },
        };
      },
      async startRun() {
        return this.continueRun();
      },
      async continueRun() {
        return {
          id: `run-${Math.random()}`,
          agentId: "bc-fail",
          status: "FINISHED",
          result: "MOCK_IMPLANT_FAIL forever",
        };
      },
      async getAgent() {
        return { id: "bc-fail", status: "ACTIVE" };
      },
      async getRun(_a: string, runId: string) {
        return {
          id: runId,
          agentId: "bc-fail",
          status: "FINISHED",
          result: "MOCK_IMPLANT_FAIL forever",
        };
      },
      async cancelRun() {},
      async waitForRun(_a: string, runId: string) {
        return this.getRun(_a, runId);
      },
    };

    const result = await runTaskLoop({
      store,
      cursor: failingCursor as unknown as MockCursorAgentProvider,
      reviewer: new HeuristicReviewer(),
      repoUrl: "https://github.com/jordymekerss-source/nexora",
      taskId: task.id,
    });

    expect(result.finalStatus).toBe("BLOCKED");
    expect(result.iterations).toBeLessThanOrEqual(4);
    expect(result.decisions.every((d) => d === "REJECT")).toBe(true);
    expect(result.decisions.length).toBeGreaterThanOrEqual(3);
  });
});
