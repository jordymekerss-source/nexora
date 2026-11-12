import type { TaskExecutor } from "../adapters/executor.js";
import type { Reviewer } from "../adapters/openai-reviewer.js";
import type { GitHubAdapter } from "../adapters/github-adapter.js";
import {
  AutomationDispatchPayloadSchema,
  nadsBranchPrefix,
  nadsTaskMarker,
  type AutomationDispatchPayload,
} from "../contracts/automation-payload.js";
import type { ExecutionJournal } from "../db/execution-journal.js";
import type { DevelopmentTask, MemoryStore } from "../db/memory-store.js";
import type { VerifiedGitHubWebhook } from "../ingress/github-webhook.js";
import { isAutomationCompletionEvent } from "../ingress/github-webhook.js";
import { hashPrompt } from "../db/execution-journal.js";

export type AutomationDispatchOutcome = {
  taskId: string;
  sent: boolean;
  status: string;
  idempotencyKey: string;
  executionId?: string;
  error?: string;
};

export type AutomationCompleteOutcome = {
  taskId: string;
  handled: boolean;
  reason: string;
  decision?: string;
  prNumber?: number | null;
  prUrl?: string | null;
};

function buildDispatchPayload(input: {
  task: DevelopmentTask;
  repoUrl: string;
  startingRef: string;
  attempt: number;
  priorRejection?: string | null;
  requiredChanges?: string[];
}): AutomationDispatchPayload {
  const attempt = input.attempt;
  const idempotencyKey = `dispatch:${input.task.id}:${attempt}`;
  const prompt = [
    `# NEXORA task: ${input.task.title}`,
    "",
    input.task.description,
    "",
    "## Acceptance criteria",
    ...input.task.acceptanceCriteria.map((item, i) => `${i + 1}. ${item}`),
    "",
    `## Correlation`,
    `- Include exactly this marker in the PR body: ${nadsTaskMarker(input.task.id)}`,
    `- Prefer branch prefix: ${nadsBranchPrefix(input.task.id)}`,
    "- Do not modify main/production.",
    "- Open a draft PR when changes are ready.",
  ].join("\n");

  return AutomationDispatchPayloadSchema.parse({
    schemaVersion: 1,
    taskId: input.task.id,
    title: input.task.title.slice(0, 200),
    prompt,
    acceptanceCriteria: input.task.acceptanceCriteria,
    attempt,
    maxAttempts: Math.min(input.task.maxRetries + 1, 4),
    correlation: {
      nadsTaskMarker: nadsTaskMarker(input.task.id),
      branchPrefix: nadsBranchPrefix(input.task.id),
      projectId: input.task.projectId,
    },
    priorRejection: input.priorRejection ?? null,
    requiredChanges: input.requiredChanges ?? [],
    repoUrl: input.repoUrl,
    startingRef: input.startingRef,
    dispatchedAt: new Date().toISOString(),
    idempotencyKey,
  });
}

/**
 * Dispatch a task via the preferred Automation executor.
 * Does not call POST /v1/agents. Does not fall back to cursor API.
 * With NADS_AUTOMATION_ENABLED=false, validates and records a disabled ack.
 */
export async function dispatchAutomationTask(options: {
  store: MemoryStore;
  executor: TaskExecutor;
  taskId: string;
  repoUrl: string;
  startingRef?: string;
  journal?: ExecutionJournal;
  priorRejection?: string | null;
  requiredChanges?: string[];
}): Promise<AutomationDispatchOutcome> {
  const { store, executor } = options;
  if (store.settings.emergencyStop) {
    throw new Error("Emergency stop is active — refusing automation dispatch");
  }
  if (!store.settings.autonomousEnabled) {
    throw new Error("Autonomous mode disabled");
  }
  if (executor.kind === "cursor") {
    throw new Error(
      "dispatchAutomationTask refuses NADS_EXECUTOR=cursor — no automatic use of prepaid Cloud Agents API",
    );
  }

  const task = store.tasks.find((row) => row.id === options.taskId);
  if (!task) throw new Error("Task not found");

  const attempt = Math.max(1, task.retryCount + 1);
  if (task.status === "READY") {
    store.transition(task.id, "CONTEXT_GATHERING", "automation dispatch");
  }
  if (task.status === "CONTEXT_GATHERING") {
    store.transition(task.id, "PROMPT_CREATED", "automation prompt");
  }
  if (task.status === "REVISION_REQUIRED") {
    store.transition(task.id, "PROMPT_CREATED", "repair prompt");
  }
  if (task.status === "PROMPT_CREATED") {
    store.transition(task.id, "AGENT_QUEUED", `automation attempt ${attempt}`);
  }
  if (task.status === "AGENT_QUEUED") {
    store.transition(task.id, "AGENT_RUNNING", "awaiting automation / GitHub completion");
  }
  if (task.status !== "AGENT_RUNNING") {
    throw new Error(`Cannot dispatch automation from status ${task.status}`);
  }

  const payload = buildDispatchPayload({
    task,
    repoUrl: options.repoUrl,
    startingRef: options.startingRef ?? "main",
    attempt,
    priorRejection: options.priorRejection,
    requiredChanges: options.requiredChanges,
  });
  task.lastPrompt = payload.prompt;

  // Idempotent event: same attempt key is a no-op append
  const existing = store.events.find((event) => event.idempotencyKey === payload.idempotencyKey);
  if (existing) {
    return {
      taskId: task.id,
      sent: false,
      status: "idempotent_replay",
      idempotencyKey: payload.idempotencyKey,
      executionId: typeof existing.payload.executionId === "string" ? existing.payload.executionId : undefined,
    };
  }

  const result = await executor.dispatch({ payload });

  store.appendEvent({
    taskId: task.id,
    eventType: "automation.dispatch",
    payload: {
      sent: result.sent,
      status: result.status,
      executionId: result.executionId ?? null,
      httpStatus: result.httpStatus ?? null,
      error: result.error ?? null,
      executor: executor.kind,
    },
    idempotencyKey: payload.idempotencyKey,
  });

  store.recordAgentSession({
    taskId: task.id,
    providerAgentId: result.executionId,
    providerRunId: result.executionId,
    branchName: undefined,
    status: result.sent ? "dispatched" : result.status,
  });

  await options.journal?.upsert({
    taskId: task.id,
    agentId: result.executionId,
    runId: result.executionId,
    iteration: attempt,
    status: result.status,
    promptHash: hashPrompt(payload.prompt),
    branchName: undefined,
    prUrl: undefined,
    updatedAt: new Date().toISOString(),
  });

  return {
    taskId: task.id,
    sent: result.sent,
    status: result.status,
    idempotencyKey: payload.idempotencyKey,
    executionId: result.executionId,
    error: result.error,
  };
}

/**
 * Complete an automation-backed task from a verified GitHub webhook.
 * Runs independent OpenAI/heuristic review when PR evidence is available.
 */
export async function completeAutomationTaskFromGitHub(options: {
  store: MemoryStore;
  reviewer: Reviewer;
  github: GitHubAdapter;
  verified: VerifiedGitHubWebhook;
  journal?: ExecutionJournal;
}): Promise<AutomationCompleteOutcome> {
  const { store, verified } = options;
  if (!isAutomationCompletionEvent(verified)) {
    return { taskId: verified.taskId ?? "unknown", handled: false, reason: "event_not_applicable" };
  }
  if (!verified.taskId) {
    return { taskId: "unknown", handled: false, reason: "missing_task_correlation" };
  }

  const task = store.tasks.find((row) => row.id === verified.taskId);
  if (!task) {
    return { taskId: verified.taskId, handled: false, reason: "task_not_found" };
  }

  const deliveryKey = `github.delivery:${verified.deliveryId}`;
  if (store.events.some((event) => event.idempotencyKey === deliveryKey)) {
    return { taskId: task.id, handled: false, reason: "duplicate_delivery" };
  }

  store.appendEvent({
    taskId: task.id,
    eventType: "github.webhook",
    payload: {
      deliveryId: verified.deliveryId,
      event: verified.event,
      action: verified.action,
      prNumber: verified.prNumber,
      prUrl: verified.prUrl,
      headBranch: verified.headBranch,
    },
    idempotencyKey: deliveryKey,
  });

  if (task.status !== "AGENT_RUNNING" && task.status !== "TESTING" && task.status !== "REVIEWING") {
    return {
      taskId: task.id,
      handled: false,
      reason: `unexpected_status_${task.status}`,
      prNumber: verified.prNumber,
      prUrl: verified.prUrl,
    };
  }

  let filesSummary = "";
  let checks: Array<{ name: string; conclusion: string | null }> = [];
  if (verified.prNumber && options.github.getPullRequest && options.github.listPullRequestFiles) {
    const pr = await options.github.getPullRequest(verified.prNumber);
    const files = await options.github.listPullRequestFiles(verified.prNumber);
    checks = await options.github.getCheckConclusions(pr.headSha);
    filesSummary = files
      .slice(0, 40)
      .map((file) => `${file.status} ${file.filename} (+${file.additions}/-${file.deletions})`)
      .join("\n");
    await options.journal?.upsert({
      taskId: task.id,
      agentId: task.assignedAgentId,
      runId: String(verified.prNumber),
      iteration: task.retryCount + 1,
      status: "github_evidence",
      promptHash: hashPrompt(task.lastPrompt ?? ""),
      branchName: pr.headRef,
      prUrl: pr.url,
      updatedAt: new Date().toISOString(),
    });
  }

  if (task.status === "AGENT_RUNNING") {
    store.transition(task.id, "TESTING", "github evidence gathered");
  }
  if (task.status === "TESTING") {
    store.transition(task.id, "REVIEWING", "independent review");
  }

  const failedChecks = checks.filter((check) => check.conclusion && check.conclusion !== "success");
  const review = await options.reviewer.review({
    taskTitle: task.title,
    acceptanceCriteria: task.acceptanceCriteria,
    prompt: task.lastPrompt ?? task.description,
    agentResult: [
      `PR ${verified.prNumber ?? "unknown"} ${verified.prUrl ?? ""}`,
      `Branch ${verified.headBranch ?? "unknown"}`,
      "Files:",
      filesSummary || "(no files fetched)",
      "Checks:",
      checks.map((check) => `${check.name}:${check.conclusion ?? "pending"}`).join(", ") || "none",
    ].join("\n"),
    testSummary: {
      commands: checks.map((check) => check.name),
      exitCodes: checks.map((check) => (check.conclusion === "success" ? 0 : 1)),
      notes: failedChecks.length
        ? `Failed checks: ${failedChecks.map((check) => check.name).join(", ")}`
        : "GitHub evidence path",
    },
  });

  store.appendEvent({
    taskId: task.id,
    eventType: "review.completed",
    payload: { decision: review.decision, summary: review.summary, source: "github_completion" },
    idempotencyKey: `review:github:${task.id}:${verified.deliveryId}`,
  });

  if (review.decision === "ACCEPT") {
    store.transition(task.id, "ACCEPTED", review.summary);
    store.transition(task.id, "NEXT_TASK", "ready for selector");
    await options.journal?.clear(task.id);
  } else if (review.decision === "BLOCKED") {
    store.transition(task.id, "BLOCKED", review.summary);
  } else {
    task.retryCount += 1;
    if (task.retryCount > Math.min(task.maxRetries, 3)) {
      store.transition(task.id, "BLOCKED", "max retries exceeded");
    } else {
      store.transition(task.id, "REVISION_REQUIRED", review.summary);
    }
  }

  return {
    taskId: task.id,
    handled: true,
    reason: "reviewed",
    decision: review.decision,
    prNumber: verified.prNumber,
    prUrl: verified.prUrl,
  };
}
