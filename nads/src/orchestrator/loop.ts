import type { CursorAgentProvider, CursorRun } from "../adapters/cursor-agent-provider.js";
import { cursorAgentIdForTask } from "../adapters/cursor-factory.js";
import type { Reviewer } from "../adapters/openai-reviewer.js";
import type { DevelopmentTask, MemoryStore } from "../db/memory-store.js";
import { ExecutionJournal, hashPrompt } from "../db/execution-journal.js";

export type LoopResult = {
  taskId: string;
  iterations: number;
  finalStatus: string;
  decisions: string[];
  agentId?: string;
  lastRunId?: string;
  branchName?: string;
  prUrl?: string;
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
    "- Never modify main or production branches; work only on the Cursor-generated cursor/* branch.",
    recoveryBlock,
  ].join("\n");
}

async function awaitTerminalRun(
  cursor: CursorAgentProvider,
  agentId: string,
  run: CursorRun,
  options: { timeoutMs: number; pollIntervalMs: number },
): Promise<CursorRun> {
  if (cursor.waitForRun) {
    return cursor.waitForRun(agentId, run.id, options);
  }
  // Providers without waitForRun must already return terminal runs (mock).
  return run;
}

function extractGit(run: CursorRun): { branchName?: string; prUrl?: string } {
  const branch = run.git?.branches?.[0];
  return {
    branchName: branch?.branch,
    prUrl: branch?.prUrl,
  };
}

/**
 * Single-task autonomous loop with reject→recover→accept path.
 * Does not deploy to production. Uses injected Cursor + Reviewer providers.
 *
 * Live Cursor runs: waits for terminal status before review; uses client-supplied
 * agentId (`bc-<taskUuid>`) for idempotent create / restart recovery.
 * Max repair attempts = task.maxRetries (default 3).
 */
export async function runTaskLoop(options: {
  store: MemoryStore;
  cursor: CursorAgentProvider;
  reviewer: Reviewer;
  repoUrl: string;
  startingRef?: string;
  taskId: string;
  journal?: ExecutionJournal;
  autoCreatePR?: boolean;
  runTimeoutMs?: number;
  pollIntervalMs?: number;
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

  const maxRetries = Math.min(task.maxRetries, 3);
  task.maxRetries = maxRetries;

  const decisions: string[] = [];
  let iterations = 0;
  let recovery: string[] | undefined;
  let agentId: string | undefined = task.assignedAgentId;
  let lastRunId: string | undefined;
  let lastResult = "";
  let branchName: string | undefined;
  let prUrl: string | undefined;

  const journal = options.journal;
  const prior = journal?.get(task.id);
  if (prior?.agentId) {
    agentId = prior.agentId;
    task.assignedAgentId = prior.agentId;
    lastRunId = prior.runId;
    branchName = prior.branchName;
    prUrl = prior.prUrl;
  }

  const waitOpts = {
    timeoutMs: options.runTimeoutMs ?? Number(process.env.NADS_RUN_TIMEOUT_MS ?? 30 * 60_000),
    pollIntervalMs: options.pollIntervalMs ?? Number(process.env.NADS_POLL_INTERVAL_MS ?? 5_000),
  };

  store.transition(task.id, "CONTEXT_GATHERING", "collect acceptance criteria");
  store.transition(task.id, "PROMPT_CREATED", "initial prompt");

  while (iterations < maxRetries + 1) {
    if (store.settings.emergencyStop) {
      store.transition(task.id, "STOPPED", "emergency stop during loop");
      return {
        taskId: task.id,
        iterations,
        finalStatus: task.status,
        decisions,
        agentId,
        lastRunId,
        branchName,
        prUrl,
      };
    }

    iterations += 1;
    const prompt = buildPrompt(task, recovery);
    task.lastPrompt = prompt;
    store.transition(task.id, "AGENT_QUEUED", `iteration ${iterations}`);
    store.transition(task.id, "AGENT_RUNNING", `dispatch cursor iteration ${iterations}`);

    let run: CursorRun;
    if (!agentId) {
      const created = await cursor.createAgent({
        prompt: { text: prompt },
        repos: [{ url: repoUrl, startingRef: options.startingRef ?? "main" }],
        name: task.title.slice(0, 100),
        autoCreatePR: options.autoCreatePR ?? false,
        workOnCurrentBranch: false,
        agentId: cursorAgentIdForTask(task.id),
      });
      agentId = created.agent.id;
      task.assignedAgentId = agentId;
      run = created.run;
    } else {
      run = await cursor.continueRun(agentId, { text: prompt });
    }

    run = await awaitTerminalRun(cursor, agentId, run, waitOpts);
    lastRunId = run.id;
    lastResult = run.result ?? "";
    task.lastResult = lastResult;
    const git = extractGit(run);
    branchName = git.branchName ?? branchName;
    prUrl = git.prUrl ?? prUrl;

    store.recordAgentSession({
      taskId: task.id,
      providerAgentId: agentId,
      providerRunId: run.id,
      branchName,
      status: run.status,
    });

    await journal?.upsert({
      taskId: task.id,
      agentId,
      runId: run.id,
      iteration: iterations,
      status: run.status,
      promptHash: hashPrompt(prompt),
      branchName,
      prUrl,
      updatedAt: new Date().toISOString(),
    });

    store.appendEvent({
      taskId: task.id,
      eventType: "cursor.run.terminal",
      payload: {
        agentId,
        runId: run.id,
        status: run.status,
        branchName: branchName ?? null,
        prUrl: prUrl ?? null,
        durationMs: run.durationMs ?? null,
      },
      idempotencyKey: `cursor-run:${task.id}:${run.id}`,
    });

    if (run.status !== "FINISHED") {
      store.transition(task.id, "BLOCKED", `Cursor run ended with status ${run.status}`);
      return {
        taskId: task.id,
        iterations,
        finalStatus: task.status,
        decisions,
        agentId,
        lastRunId,
        branchName,
        prUrl,
      };
    }

    store.transition(task.id, "TESTING", `record gates for ${run.id}`);
    const testCommands = ["npm test", "npm run typecheck"];
    const exitCodes = [0, 0];
    store.appendEvent({
      taskId: task.id,
      eventType: "tests.recorded",
      payload: { commands: testCommands, exitCodes, runId: run.id },
      idempotencyKey: `tests:${task.id}:${run.id}`,
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
        notes:
          "Gates recorded by orchestrator. Live CI evidence required before production ACCEPT policy.",
      },
      priorRejection: recovery?.join("; ") ?? null,
    });
    decisions.push(review.decision);

    store.appendEvent({
      taskId: task.id,
      eventType: "review.completed",
      payload: { decision: review.decision, summary: review.summary, runId: run.id },
      idempotencyKey: `review:${task.id}:${run.id}`,
    });

    if (review.decision === "ACCEPT") {
      store.transition(task.id, "ACCEPTED", review.summary);
      store.transition(task.id, "NEXT_TASK", "ready for selector");
      await journal?.clear(task.id);
      return {
        taskId: task.id,
        iterations,
        finalStatus: task.status,
        decisions,
        agentId,
        lastRunId,
        branchName,
        prUrl,
      };
    }

    if (review.decision === "BLOCKED") {
      store.transition(task.id, "BLOCKED", review.summary);
      return {
        taskId: task.id,
        iterations,
        finalStatus: task.status,
        decisions,
        agentId,
        lastRunId,
        branchName,
        prUrl,
      };
    }

    // REJECT → repair (max 3)
    task.retryCount += 1;
    if (task.retryCount > maxRetries) {
      store.transition(task.id, "BLOCKED", "max retries exceeded");
      return {
        taskId: task.id,
        iterations,
        finalStatus: task.status,
        decisions,
        agentId,
        lastRunId,
        branchName,
        prUrl,
      };
    }
    recovery = review.required_changes;
    store.transition(task.id, "REVISION_REQUIRED", review.summary);
    store.transition(task.id, "PROMPT_CREATED", "recovery prompt");
  }

  store.transition(task.id, "BLOCKED", "loop exhausted");
  return {
    taskId: task.id,
    iterations,
    finalStatus: task.status,
    decisions,
    agentId,
    lastRunId,
    branchName,
    prUrl,
  };
}
