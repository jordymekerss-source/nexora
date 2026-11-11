import type { CursorAgentProvider } from "../adapters/cursor-agent-provider.js";
import type { Reviewer } from "../adapters/openai-reviewer.js";
import type { DevelopmentTask, MemoryStore } from "../db/memory-store.js";

export type LoopResult = {
  taskId: string;
  iterations: number;
  finalStatus: string;
  decisions: string[];
};

function buildPrompt(task: DevelopmentTask, recovery?: string[]): string {
  const criteria = task.acceptanceCriteria.map((item, i) => `${i + 1}. ${item}`).join("\n");
  const recoveryBlock =
    recovery && recovery.length > 0
      ? `\n\n## Recovery requirements\n${recovery.map((item) => `- ${item}`).join("\n")}`
      : "";
  return [
    `# NEXORA task: ${task.title}`,
    "",
    task.description,
    "",
    "## Acceptance criteria",
    criteria || "- Meet task description",
    "",
    "## Rules",
    "- Do not remove or skip tests to force green.",
    "- Do not invent integrations.",
    "- Prefer additive migrations.",
    "- Keep control plane (/nads) separate from SaaS (/src) unless the task says otherwise.",
    "- Run relevant tests and report real exit codes.",
    recoveryBlock,
  ].join("\n");
}

/**
 * Single-task autonomous loop with reject→recover→accept path.
 * Does not deploy to production. Uses injected Cursor + Reviewer providers.
 */
export async function runTaskLoop(options: {
  store: MemoryStore;
  cursor: CursorAgentProvider;
  reviewer: Reviewer;
  repoUrl: string;
  startingRef?: string;
  taskId: string;
}): Promise<LoopResult> {
  const { store, cursor, reviewer, repoUrl } = options;
  if (store.settings.emergencyStop) {
    throw new Error("Emergency stop is active — refusing to start agents");
  }
  if (!store.settings.autonomousEnabled) {
    throw new Error("Autonomous mode disabled");
  }

  const task = store.tasks.find((row) => row.id === options.taskId);
  if (!task) throw new Error("Task not found");

  const decisions: string[] = [];
  let iterations = 0;
  let recovery: string[] | undefined;
  let agentId: string | undefined;
  let lastResult = "";

  store.transition(task.id, "CONTEXT_GATHERING", "collect acceptance criteria");
  store.transition(task.id, "PROMPT_CREATED", "initial prompt");

  while (iterations < task.maxRetries + 1) {
    iterations += 1;
    const prompt = buildPrompt(task, recovery);
    task.lastPrompt = prompt;
    store.transition(task.id, "AGENT_QUEUED", `iteration ${iterations}`);
    store.transition(task.id, "AGENT_RUNNING", `dispatch cursor iteration ${iterations}`);

    let runId: string;
    if (!agentId) {
      const created = await cursor.createAgent({
        prompt: { text: prompt },
        repos: [{ url: repoUrl, startingRef: options.startingRef ?? "main" }],
        name: task.title.slice(0, 100),
        autoCreatePR: false,
      });
      agentId = created.agent.id;
      task.assignedAgentId = agentId;
      runId = created.run.id;
      lastResult = created.run.result ?? "";
    } else {
      const run = await cursor.continueRun(agentId, { text: prompt });
      runId = run.id;
      lastResult = run.result ?? "";
    }
    task.lastResult = lastResult;

    store.transition(task.id, "TESTING", `record gates for ${runId}`);
    // Dry-run records intended commands; live CI wiring lands in later phases.
    const testCommands = ["npm test", "npm run typecheck"];
    const exitCodes = [0, 0];
    store.appendEvent({
      taskId: task.id,
      eventType: "tests.recorded",
      payload: { commands: testCommands, exitCodes, runId },
      idempotencyKey: `tests:${task.id}:${runId}`,
    });

    store.transition(task.id, "REVIEWING", "independent review");
    const review = await reviewer.review({
      taskTitle: task.title,
      acceptanceCriteria: task.acceptanceCriteria,
      prompt,
      agentResult: lastResult,
      testSummary: {
        commands: testCommands,
        exitCodes,
        notes: "Dry-run recorded intended gates; live evidence required for production ACCEPT.",
      },
      priorRejection: recovery?.join("; ") ?? null,
    });
    decisions.push(review.decision);

    store.appendEvent({
      taskId: task.id,
      eventType: "review.completed",
      payload: { decision: review.decision, summary: review.summary, runId },
      idempotencyKey: `review:${task.id}:${runId}`,
    });

    if (review.decision === "ACCEPT") {
      store.transition(task.id, "ACCEPTED", review.summary);
      store.transition(task.id, "NEXT_TASK", "ready for selector");
      return { taskId: task.id, iterations, finalStatus: task.status, decisions };
    }

    if (review.decision === "BLOCKED") {
      store.transition(task.id, "BLOCKED", review.summary);
      return { taskId: task.id, iterations, finalStatus: task.status, decisions };
    }

    // REJECT
    task.retryCount += 1;
    if (task.retryCount > task.maxRetries) {
      store.transition(task.id, "BLOCKED", "max retries exceeded");
      return { taskId: task.id, iterations, finalStatus: task.status, decisions };
    }
    recovery = review.required_changes;
    store.transition(task.id, "REVISION_REQUIRED", review.summary);
    store.transition(task.id, "PROMPT_CREATED", "recovery prompt");
  }

  store.transition(task.id, "BLOCKED", "loop exhausted");
  return { taskId: task.id, iterations, finalStatus: task.status, decisions };
}
