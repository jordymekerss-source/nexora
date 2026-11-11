#!/usr/bin/env node
import { MockCursorAgentProvider } from "./adapters/mock-cursor-adapter.js";
import { HeuristicReviewer } from "./adapters/openai-reviewer.js";
import { MemoryStore } from "./db/memory-store.js";
import { runTaskLoop } from "./orchestrator/loop.js";

async function dryRun(): Promise<void> {
  const store = new MemoryStore();
  const task = store.seedTask({
    title: "P0: verify signup privilege lock documentation",
    description:
      "Ensure handle_new_user ignores role/tenant metadata and document the regression SQL.",
    priority: 1,
    category: "P0",
    acceptanceCriteria: [
      "Signup cannot grant super_admin via metadata",
      "Regression checklist exists under supabase/tests",
      "No SaaS runtime dependency on /nads",
    ],
  });

  const result = await runTaskLoop({
    store,
    cursor: new MockCursorAgentProvider(),
    reviewer: new HeuristicReviewer(),
    repoUrl: "https://github.com/jordymekerss-source/nexora",
    startingRef: "main",
    taskId: task.id,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.finalStatus === "NEXT_TASK",
        result,
        transitions: store.transitions,
        eventCount: store.events.length,
      },
      null,
      2,
    ),
  );

  if (result.finalStatus !== "NEXT_TASK") {
    process.exitCode = 2;
  }
}

const command = process.argv[2] ?? "dry-run";
if (command === "dry-run") {
  dryRun().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}. Use: dry-run`);
  process.exit(1);
}
