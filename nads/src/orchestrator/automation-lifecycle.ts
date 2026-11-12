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
import { hashPrompt } from "../db/execution-journal.js";
import type { DevelopmentTask, MemoryStore } from "../db/memory-store.js";
import {
  payloadHashOf,
  type WebhookReceiptStore,
} from "../db/webhook-receipts.js";
import type { VerifiedGitHubWebhook } from "../ingress/github-webhook.js";
import { isAutomationCompletionEvent } from "../ingress/github-webhook.js";
import type { AutomationCallbackPayload } from "../contracts/automation-payload.js";

export type AutomationDispatchOutcome = {
  taskId: string;
  sent: boolean;
  status: string;
  idempotencyKey: string;
  executionId?: string;
  error?: string;
  attempts?: number;
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
  receipts?: WebhookReceiptStore;
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
  task.dispatchIdempotencyKey = payload.idempotencyKey;
  task.executorKind = executor.kind === "automation" ? "automation" : "mock";

  // Idempotent event: same attempt key is a no-op append
  const existing = store.events.find((event) => event.idempotencyKey === payload.idempotencyKey);
  if (existing) {
    return {
      taskId: task.id,
      sent: false,
      status: "idempotent_replay",
      idempotencyKey: payload.idempotencyKey,
      executionId:
        typeof existing.payload.executionId === "string" ? existing.payload.executionId : undefined,
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
      attempts: result.attempts ?? null,
    },
    idempotencyKey: payload.idempotencyKey,
  });

  if (result.executionId) {
    task.externalExecutionId = result.executionId;
  }

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
    executorKind: task.executorKind,
    updatedAt: new Date().toISOString(),
  });

  return {
    taskId: task.id,
    sent: result.sent,
    status: result.status,
    idempotencyKey: payload.idempotencyKey,
    executionId: result.executionId,
    error: result.error,
    attempts: result.attempts,
  };
}

async function claimDelivery(options: {
  store: MemoryStore;
  receipts: WebhookReceiptStore;
  taskId: string;
  provider: "github" | "automation_callback";
  deliveryId: string;
  eventType: string;
  payloadHash?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deliveryClaim = await options.receipts.tryClaim({
    projectId: options.store.projectId,
    provider: options.provider,
    deliveryId: options.deliveryId,
    eventType: options.eventType,
    payloadHash: options.payloadHash ?? null,
    taskId: options.taskId,
  });
  if (!deliveryClaim.claimed) {
    return {
      ok: false,
      reason: deliveryClaim.reason === "duplicate" ? "duplicate_delivery" : "receipt_store_unavailable",
    };
  }
  return { ok: true };
}

async function claimExclusiveCompletion(options: {
  store: MemoryStore;
  receipts: WebhookReceiptStore;
  taskId: string;
  payloadHash?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const completionClaim = await options.receipts.tryClaim({
    projectId: options.store.projectId,
    provider: "completion_claim",
    deliveryId: options.taskId,
    eventType: "automation.complete",
    payloadHash: options.payloadHash ?? null,
    taskId: options.taskId,
  });
  if (!completionClaim.claimed) {
    return {
      ok: false,
      reason:
        completionClaim.reason === "duplicate" ? "duplicate_completion" : "receipt_store_unavailable",
    };
  }
  return { ok: true };
}

/**
 * Complete an automation-backed task from a verified GitHub webhook.
 * Runs independent OpenAI/heuristic review when PR evidence is available.
 * Distinct deliveries for the same task cannot double-complete.
 */
export async function completeAutomationTaskFromGitHub(options: {
  store: MemoryStore;
  reviewer: Reviewer;
  github: GitHubAdapter;
  verified: VerifiedGitHubWebhook;
  journal?: ExecutionJournal;
  receipts?: WebhookReceiptStore;
  rawBody?: string | Buffer;
}): Promise<AutomationCompleteOutcome> {
  const { store, verified } = options;
  const receipts = options.receipts ?? store.receipts;

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

  const payloadHash = payloadHashOf(options.rawBody);
  const delivery = await claimDelivery({
    store,
    receipts,
    taskId: task.id,
    provider: "github",
    deliveryId: verified.deliveryId,
    eventType: `${verified.event}:${verified.action ?? "none"}`,
    payloadHash,
  });
  if (!delivery.ok) {
    return {
      taskId: task.id,
      handled: false,
      reason: delivery.reason,
      prNumber: verified.prNumber,
      prUrl: verified.prUrl,
    };
  }

  // Mirror into in-memory event log for observability (receipt store is authoritative).
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
    idempotencyKey: `github.delivery:${verified.deliveryId}`,
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

  const completion = await claimExclusiveCompletion({
    store,
    receipts,
    taskId: task.id,
    payloadHash,
  });
  if (!completion.ok) {
    return {
      taskId: task.id,
      handled: false,
      reason: completion.reason,
      prNumber: verified.prNumber,
      prUrl: verified.prUrl,
    };
  }

  let filesSummary = "";
  let checks: Array<{ name: string; conclusion: string | null }> = [];
  if (verified.prNumber && options.github.getPullRequest && options.github.listPullRequestFiles) {
    const pr = await options.github.getPullRequest(verified.prNumber);
    if (pr.merged) {
      store.transition(task.id, "BLOCKED", "PR already merged — refusing ACCEPT");
      return {
        taskId: task.id,
        handled: true,
        reason: "pr_merged_blocked",
        decision: "BLOCKED",
        prNumber: verified.prNumber,
        prUrl: verified.prUrl,
      };
    }
    const files = await options.github.listPullRequestFiles(verified.prNumber);
    checks = await options.github.getCheckConclusions(pr.headSha);
    filesSummary = files
      .slice(0, 40)
      .map((file) => `${file.status} ${file.filename} (+${file.additions}/-${file.deletions})`)
      .join("\n");
    task.prNumber = pr.number;
    task.prUrl = pr.url;
    task.headBranch = pr.headRef;
    await options.journal?.upsert({
      taskId: task.id,
      agentId: task.assignedAgentId ?? task.externalExecutionId,
      runId: String(verified.prNumber),
      iteration: task.retryCount + 1,
      status: "github_evidence",
      promptHash: hashPrompt(task.lastPrompt ?? ""),
      branchName: pr.headRef,
      prUrl: pr.url,
      prNumber: pr.number,
      executorKind: task.executorKind,
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

/**
 * Optional Automation callback completion (NADS-signed bridge only).
 * Does not call Cursor APIs. Still requires exclusive completion claim.
 */
export async function completeAutomationTaskFromCallback(options: {
  store: MemoryStore;
  reviewer: Reviewer;
  github: GitHubAdapter;
  callback: AutomationCallbackPayload;
  journal?: ExecutionJournal;
  receipts?: WebhookReceiptStore;
  rawBody?: string | Buffer;
}): Promise<AutomationCompleteOutcome> {
  const { store, callback } = options;
  const receipts = options.receipts ?? store.receipts;
  const task = store.tasks.find((row) => row.id === callback.taskId);
  if (!task) {
    return { taskId: callback.taskId, handled: false, reason: "task_not_found" };
  }

  if (callback.status !== "succeeded") {
    return {
      taskId: task.id,
      handled: false,
      reason: `callback_status_${callback.status}`,
      prNumber: callback.prNumber ?? null,
      prUrl: callback.prUrl ?? null,
    };
  }

  const deliveryId = `${callback.executionId}:${callback.status}:${callback.occurredAt}`;
  const payloadHash = payloadHashOf(options.rawBody);
  const delivery = await claimDelivery({
    store,
    receipts,
    taskId: task.id,
    provider: "automation_callback",
    deliveryId,
    eventType: `callback:${callback.status}`,
    payloadHash,
  });
  if (!delivery.ok) {
    return { taskId: task.id, handled: false, reason: delivery.reason };
  }
  if (task.status !== "AGENT_RUNNING" && task.status !== "TESTING" && task.status !== "REVIEWING") {
    return { taskId: task.id, handled: false, reason: `unexpected_status_${task.status}` };
  }
  const completion = await claimExclusiveCompletion({
    store,
    receipts,
    taskId: task.id,
    payloadHash,
  });
  if (!completion.ok) {
    return { taskId: task.id, handled: false, reason: completion.reason };
  }

  if (!(callback.prNumber && options.github.getPullRequest)) {
    return { taskId: task.id, handled: false, reason: "callback_missing_pr" };
  }

  const pr = await options.github.getPullRequest(callback.prNumber);
  task.prNumber = pr.number;
  task.prUrl = pr.url;
  task.headBranch = pr.headRef;
  if (task.status === "AGENT_RUNNING") store.transition(task.id, "TESTING", "callback evidence");
  if (task.status === "TESTING") store.transition(task.id, "REVIEWING", "independent review");
  const review = await options.reviewer.review({
    taskTitle: task.title,
    acceptanceCriteria: task.acceptanceCriteria,
    prompt: task.lastPrompt ?? task.description,
    agentResult: `Callback succeeded. PR ${pr.number} ${pr.url} branch ${pr.headRef}`,
    testSummary: { commands: [], exitCodes: [], notes: "automation callback path" },
  });
  store.appendEvent({
    taskId: task.id,
    eventType: "review.completed",
    payload: { decision: review.decision, summary: review.summary, source: "automation_callback" },
    idempotencyKey: `review:callback:${task.id}:${deliveryId}`,
  });
  if (review.decision === "ACCEPT") {
    store.transition(task.id, "ACCEPTED", review.summary);
    store.transition(task.id, "NEXT_TASK", "ready for selector");
    await options.journal?.clear(task.id);
  } else if (review.decision === "BLOCKED") {
    store.transition(task.id, "BLOCKED", review.summary);
  } else {
    task.retryCount += 1;
    store.transition(
      task.id,
      task.retryCount > Math.min(task.maxRetries, 3) ? "BLOCKED" : "REVISION_REQUIRED",
      review.summary,
    );
  }
  return {
    taskId: task.id,
    handled: true,
    reason: "reviewed",
    decision: review.decision,
    prNumber: pr.number,
    prUrl: pr.url,
  };
}
