import { randomUUID } from "node:crypto";
import type { TaskExecutor } from "../adapters/executor.js";
import type { Reviewer } from "../adapters/openai-reviewer.js";
import {
  parseGithubRepoUrl,
  type GitHubAdapter,
} from "../adapters/github-adapter.js";
import { isUncertainDispatchStatus } from "../adapters/automation-executor.js";
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
  DEFAULT_COMPLETION_LEASE_TTL_MS,
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
  uncertain?: boolean;
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
 * Explicitly clear an uncertain dispatch so another Automation POST may proceed.
 * Does not call Cursor APIs.
 */
export function reconcileUncertainDispatch(
  store: MemoryStore,
  taskId: string,
  token: string,
): { ok: true } | { ok: false; reason: string } {
  const task = store.tasks.find((row) => row.id === taskId);
  if (!task) return { ok: false, reason: "task_not_found" };
  if (!task.dispatchUncertain) return { ok: false, reason: "not_uncertain" };
  if (!task.dispatchReconcileToken || task.dispatchReconcileToken !== token) {
    return { ok: false, reason: "invalid_reconcile_token" };
  }
  const priorOutcome = task.dispatchOutcome ?? null;
  task.dispatchUncertain = false;
  task.dispatchReconcileToken = undefined;
  task.dispatchOutcome = "reconciled";
  store.appendEvent({
    taskId: task.id,
    eventType: "automation.dispatch.reconciled",
    payload: { priorOutcome },
    idempotencyKey: `dispatch.reconcile:${task.id}:${token}`,
  });
  return { ok: true };
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

  if (task.dispatchUncertain) {
    return {
      taskId: task.id,
      sent: false,
      status: "uncertain_requires_reconcile",
      idempotencyKey: task.dispatchIdempotencyKey ?? `dispatch:${task.id}:blocked`,
      error:
        "Prior Automation POST outcome is uncertain — call reconcileUncertainDispatch before another dispatch",
      uncertain: true,
    };
  }

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

  const startingRef = options.startingRef ?? "main";
  const payload = buildDispatchPayload({
    task,
    repoUrl: options.repoUrl,
    startingRef,
    attempt,
    priorRejection: options.priorRejection,
    requiredChanges: options.requiredChanges,
  });
  task.lastPrompt = payload.prompt;
  task.dispatchIdempotencyKey = payload.idempotencyKey;
  task.executorKind = executor.kind === "automation" ? "automation" : "mock";
  // Bind expected identity for mandatory PR verification on completion.
  task.expectedRepoUrl = options.repoUrl;
  task.expectedStartingRef = startingRef;
  task.expectedBranchPrefix = payload.correlation.branchPrefix;
  task.expectedTaskMarker = payload.correlation.nadsTaskMarker;

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

  const uncertain =
    Boolean(result.uncertain) || isUncertainDispatchStatus(result.status);
  task.dispatchOutcome = result.status;
  if (uncertain) {
    task.dispatchUncertain = true;
    task.dispatchReconcileToken = randomUUID();
  }

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
      uncertain,
      // Never persist reconcile token in event payload (ops-only on task record).
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
    status: uncertain ? "uncertain" : result.sent ? "dispatched" : result.status,
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
    uncertain,
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

async function acquireCompletionLease(options: {
  store: MemoryStore;
  receipts: WebhookReceiptStore;
  taskId: string;
  provider: "github" | "automation_callback";
  deliveryId: string;
  leaseOwner: string;
  payloadHash?: string | null;
  leaseTtlMs?: number;
}): Promise<{ ok: true; leaseOwner: string } | { ok: false; reason: string }> {
  const result = await options.receipts.tryAcquireCompletionLease({
    projectId: options.store.projectId,
    taskId: options.taskId,
    provider: options.provider,
    deliveryId: options.deliveryId,
    leaseOwner: options.leaseOwner,
    payloadHash: options.payloadHash ?? null,
    leaseTtlMs:
      options.leaseTtlMs ??
      Number(process.env.NADS_COMPLETION_LEASE_MS ?? DEFAULT_COMPLETION_LEASE_TTL_MS),
  });
  if (!result.acquired) {
    if (result.reason === "completed") {
      return { ok: false, reason: "duplicate_completion" };
    }
    if (result.reason === "held") {
      return { ok: false, reason: "completion_lease_held" };
    }
    return { ok: false, reason: "receipt_store_unavailable" };
  }
  return { ok: true, leaseOwner: options.leaseOwner };
}

function sanitizeVerifyErrors(errors: string[]): string {
  return errors
    .map((err) => err.replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED]").slice(0, 120))
    .slice(0, 8)
    .join("; ");
}

async function verifyBoundPullRequest(options: {
  store: MemoryStore;
  github: GitHubAdapter;
  task: DevelopmentTask;
  prNumber?: number | null;
}): Promise<{ ok: true; prNumber: number | null; prUrl: string | null; headBranch: string | null } | { ok: false; reason: string }> {
  const { task } = options;
  const repoUrl = task.expectedRepoUrl;
  const marker = task.expectedTaskMarker ?? nadsTaskMarker(task.id);
  const branchPrefix = task.expectedBranchPrefix ?? nadsBranchPrefix(task.id);

  if (!repoUrl) {
    return { ok: false, reason: "missing_dispatch_binding" };
  }
  const parsed = parseGithubRepoUrl(repoUrl);
  if (!parsed) {
    return { ok: false, reason: "invalid_expected_repo_url" };
  }

  const verification = await options.github.verifyTaskPullRequest({
    taskId: task.id,
    taskMarker: marker,
    expectedOwner: parsed.owner,
    expectedRepo: parsed.repo,
    prNumber: options.prNumber,
    expectedBranchPrefix: branchPrefix,
  });

  if (!verification.ok) {
    const sanitized = sanitizeVerifyErrors(verification.errors);
    options.store.appendEvent({
      taskId: task.id,
      eventType: "github.pr_verification_failed",
      payload: {
        reason: sanitized,
        prNumber: verification.prNumber,
        repositoryMatch: verification.repositoryMatch,
        markerPresent: verification.markerPresent,
        branchExists: verification.branchExists,
        notMerged: verification.notMerged,
      },
      idempotencyKey: `github.verify.fail:${task.id}:${options.prNumber ?? "none"}:${sanitized.slice(0, 40)}`,
    });
    const primary = verification.errors[0] ?? "pr_verification_failed";
    if (primary === "missing_github_token") {
      return { ok: false, reason: "missing_github_token" };
    }
    return { ok: false, reason: `pr_verification_failed:${primary}` };
  }

  return {
    ok: true,
    prNumber: verification.prNumber,
    prUrl: verification.prUrl,
    headBranch: verification.headBranch,
  };
}

async function runReviewAndTransition(options: {
  store: MemoryStore;
  reviewer: Reviewer;
  task: DevelopmentTask;
  journal?: ExecutionJournal;
  agentResult: string;
  testSummary: { commands: string[]; exitCodes: number[]; notes: string };
  idempotencyKey: string;
  source: string;
}): Promise<{ decision: string }> {
  const { store, task } = options;
  if (task.status === "AGENT_RUNNING") {
    store.transition(task.id, "TESTING", `${options.source} evidence gathered`);
  }
  if (task.status === "TESTING") {
    store.transition(task.id, "REVIEWING", "independent review");
  }

  const review = await options.reviewer.review({
    taskTitle: task.title,
    acceptanceCriteria: task.acceptanceCriteria,
    prompt: task.lastPrompt ?? task.description,
    agentResult: options.agentResult,
    testSummary: options.testSummary,
  });

  store.appendEvent({
    taskId: task.id,
    eventType: "review.completed",
    payload: { decision: review.decision, summary: review.summary, source: options.source },
    idempotencyKey: options.idempotencyKey,
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

  return { decision: review.decision };
}

/**
 * Complete an automation-backed task from a verified GitHub webhook.
 * Mandatory PR verification uses the bound dispatch record.
 * Completion uses recoverable leases — failures release the claim.
 */
export async function completeAutomationTaskFromGitHub(options: {
  store: MemoryStore;
  reviewer: Reviewer;
  github: GitHubAdapter;
  verified: VerifiedGitHubWebhook;
  journal?: ExecutionJournal;
  receipts?: WebhookReceiptStore;
  rawBody?: string | Buffer;
  leaseOwner?: string;
  leaseTtlMs?: number;
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

  const leaseOwner = options.leaseOwner ?? `worker:${randomUUID()}`;
  const lease = await acquireCompletionLease({
    store,
    receipts,
    taskId: task.id,
    provider: "github",
    deliveryId: verified.deliveryId,
    leaseOwner,
    payloadHash,
    leaseTtlMs: options.leaseTtlMs,
  });
  if (!lease.ok) {
    return {
      taskId: task.id,
      handled: false,
      reason: lease.reason,
      prNumber: verified.prNumber,
      prUrl: verified.prUrl,
    };
  }

  const release = async (reason: string) => {
    await receipts.releaseCompletionLease({
      projectId: store.projectId,
      taskId: task.id,
      leaseOwner,
      reason,
      status: "failed",
    });
  };

  try {
    const verifiedPr = await verifyBoundPullRequest({
      store,
      github: options.github,
      task,
      prNumber: verified.prNumber,
    });
    if (!verifiedPr.ok) {
      await release(verifiedPr.reason);
      return {
        taskId: task.id,
        handled: false,
        reason: verifiedPr.reason,
        prNumber: verified.prNumber,
        prUrl: verified.prUrl,
      };
    }

    let filesSummary = "";
    let checks: Array<{ name: string; conclusion: string | null }> = [];
    const prNumber = verifiedPr.prNumber ?? verified.prNumber;

    if (prNumber && options.github.getPullRequest && options.github.listPullRequestFiles) {
      let pr;
      try {
        pr = await options.github.getPullRequest(prNumber);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message.slice(0, 200) : "pr_retrieval_failed";
        await release(`pr_retrieval_failed:${message}`);
        return {
          taskId: task.id,
          handled: false,
          reason: "pr_retrieval_failed",
          prNumber,
          prUrl: verified.prUrl,
        };
      }
      if (pr.merged) {
        store.transition(task.id, "BLOCKED", "PR already merged — refusing ACCEPT");
        await receipts.finalizeCompletionLease({
          projectId: store.projectId,
          taskId: task.id,
          leaseOwner,
        });
        return {
          taskId: task.id,
          handled: true,
          reason: "pr_merged_blocked",
          decision: "BLOCKED",
          prNumber,
          prUrl: pr.url,
        };
      }
      try {
        const files = await options.github.listPullRequestFiles(prNumber);
        checks = await options.github.getCheckConclusions(pr.headSha);
        filesSummary = files
          .slice(0, 40)
          .map((file) => `${file.status} ${file.filename} (+${file.additions}/-${file.deletions})`)
          .join("\n");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message.slice(0, 200) : "evidence_failed";
        await release(`evidence_failed:${message}`);
        return {
          taskId: task.id,
          handled: false,
          reason: "evidence_retrieval_failed",
          prNumber,
          prUrl: pr.url,
        };
      }
      task.prNumber = pr.number;
      task.prUrl = pr.url;
      task.headBranch = pr.headRef;
      await options.journal?.upsert({
        taskId: task.id,
        agentId: task.assignedAgentId ?? task.externalExecutionId,
        runId: String(prNumber),
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

    let decision: string;
    try {
      const failedChecks = checks.filter(
        (check) => check.conclusion && check.conclusion !== "success",
      );
      const reviewed = await runReviewAndTransition({
        store,
        reviewer: options.reviewer,
        task,
        journal: options.journal,
        agentResult: [
          `PR ${prNumber ?? "unknown"} ${verifiedPr.prUrl ?? verified.prUrl ?? ""}`,
          `Branch ${verifiedPr.headBranch ?? verified.headBranch ?? "unknown"}`,
          "Files:",
          filesSummary || "(no files fetched)",
          "Checks:",
          checks.map((check) => `${check.name}:${check.conclusion ?? "pending"}`).join(", ") ||
            "none",
        ].join("\n"),
        testSummary: {
          commands: checks.map((check) => check.name),
          exitCodes: checks.map((check) => (check.conclusion === "success" ? 0 : 1)),
          notes: failedChecks.length
            ? `Failed checks: ${failedChecks.map((check) => check.name).join(", ")}`
            : "GitHub evidence path",
        },
        idempotencyKey: `review:github:${task.id}:${verified.deliveryId}`,
        source: "github_completion",
      });
      decision = reviewed.decision;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "review_failed";
      await release(`review_failed:${message}`);
      // Never silently mark completed after a failed review.
      if (task.status === "REVIEWING" || task.status === "TESTING") {
        // Leave non-terminal; do not invent ACCEPT.
      }
      return {
        taskId: task.id,
        handled: false,
        reason: "review_failed",
        prNumber: task.prNumber ?? prNumber,
        prUrl: task.prUrl ?? verified.prUrl,
      };
    }

    if (decision === "ACCEPT" || decision === "BLOCKED") {
      await receipts.finalizeCompletionLease({
        projectId: store.projectId,
        taskId: task.id,
        leaseOwner,
      });
    } else {
      // REJECT → revision: release lease so a later PR can complete.
      await receipts.releaseCompletionLease({
        projectId: store.projectId,
        taskId: task.id,
        leaseOwner,
        reason: "revision_required",
        status: "released",
      });
    }

    return {
      taskId: task.id,
      handled: true,
      reason: "reviewed",
      decision,
      prNumber: task.prNumber ?? prNumber,
      prUrl: task.prUrl ?? verified.prUrl,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "completion_failed";
    await release(`completion_failed:${message}`);
    return {
      taskId: task.id,
      handled: false,
      reason: "completion_failed",
      prNumber: verified.prNumber,
      prUrl: verified.prUrl,
    };
  }
}

/**
 * Optional Automation callback completion (NADS-signed bridge only).
 * Does not call Cursor APIs. Still requires exclusive recoverable completion lease
 * and mandatory PR verification bound to the dispatch record.
 */
export async function completeAutomationTaskFromCallback(options: {
  store: MemoryStore;
  reviewer: Reviewer;
  github: GitHubAdapter;
  callback: AutomationCallbackPayload;
  journal?: ExecutionJournal;
  receipts?: WebhookReceiptStore;
  rawBody?: string | Buffer;
  leaseOwner?: string;
  leaseTtlMs?: number;
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

  const leaseOwner = options.leaseOwner ?? `worker:${randomUUID()}`;
  const lease = await acquireCompletionLease({
    store,
    receipts,
    taskId: task.id,
    provider: "automation_callback",
    deliveryId,
    leaseOwner,
    payloadHash,
    leaseTtlMs: options.leaseTtlMs,
  });
  if (!lease.ok) {
    return { taskId: task.id, handled: false, reason: lease.reason };
  }

  const release = async (reason: string) => {
    await receipts.releaseCompletionLease({
      projectId: store.projectId,
      taskId: task.id,
      leaseOwner,
      reason,
      status: "failed",
    });
  };

  try {
    if (!(callback.prNumber && options.github.getPullRequest)) {
      await release("callback_missing_pr");
      return { taskId: task.id, handled: false, reason: "callback_missing_pr" };
    }

    const verifiedPr = await verifyBoundPullRequest({
      store,
      github: options.github,
      task,
      prNumber: callback.prNumber,
    });
    if (!verifiedPr.ok) {
      await release(verifiedPr.reason);
      return { taskId: task.id, handled: false, reason: verifiedPr.reason };
    }

    let pr;
    try {
      pr = await options.github.getPullRequest(callback.prNumber);
    } catch {
      await release("pr_retrieval_failed");
      return { taskId: task.id, handled: false, reason: "pr_retrieval_failed" };
    }

    task.prNumber = pr.number;
    task.prUrl = pr.url;
    task.headBranch = pr.headRef;

    let decision: string;
    try {
      const reviewed = await runReviewAndTransition({
        store,
        reviewer: options.reviewer,
        task,
        journal: options.journal,
        agentResult: `Callback succeeded. PR ${pr.number} ${pr.url} branch ${pr.headRef}`,
        testSummary: { commands: [], exitCodes: [], notes: "automation callback path" },
        idempotencyKey: `review:callback:${task.id}:${deliveryId}`,
        source: "automation_callback",
      });
      decision = reviewed.decision;
    } catch {
      await release("review_failed");
      return { taskId: task.id, handled: false, reason: "review_failed" };
    }

    if (decision === "ACCEPT" || decision === "BLOCKED") {
      await receipts.finalizeCompletionLease({
        projectId: store.projectId,
        taskId: task.id,
        leaseOwner,
      });
    } else {
      await receipts.releaseCompletionLease({
        projectId: store.projectId,
        taskId: task.id,
        leaseOwner,
        reason: "revision_required",
        status: "released",
      });
    }

    return {
      taskId: task.id,
      handled: true,
      reason: "reviewed",
      decision,
      prNumber: pr.number,
      prUrl: pr.url,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "completion_failed";
    await release(`completion_failed:${message}`);
    return { taskId: task.id, handled: false, reason: "completion_failed" };
  }
}
