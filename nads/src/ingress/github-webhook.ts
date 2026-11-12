import { createHmac, timingSafeEqual } from "node:crypto";
import { parseNadsTaskIdFromText } from "../contracts/automation-payload.js";

export type GitHubWebhookHeaders = {
  "x-github-delivery"?: string;
  "x-github-event"?: string;
  "x-hub-signature-256"?: string;
  "x-nads-timestamp"?: string;
};

export type VerifiedGitHubWebhook = {
  deliveryId: string;
  event: string;
  payload: Record<string, unknown>;
  taskId: string | null;
  prNumber: number | null;
  prUrl: string | null;
  headBranch: string | null;
  action: string | null;
};

export type GitHubWebhookVerifyOptions = {
  secret: string;
  /** Max age for optional X-NADS-Timestamp / replay window (ms). */
  maxSkewMs?: number;
  nowMs?: number;
  /** Previously seen delivery IDs for idempotency. */
  seenDeliveryIds?: Set<string>;
};

export class GitHubWebhookError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GitHubWebhookError";
    this.code = code;
  }
}

function header(headers: GitHubWebhookHeaders | Record<string, string | undefined>, name: string): string {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value) return value;
  }
  return "";
}

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256) and basic replay guards.
 * rawBody must be the exact request bytes used for HMAC.
 */
export function verifyGitHubWebhookSignature(
  rawBody: string | Buffer,
  headers: GitHubWebhookHeaders | Record<string, string | undefined>,
  options: GitHubWebhookVerifyOptions,
): VerifiedGitHubWebhook {
  const secret = options.secret?.trim();
  if (!secret) {
    throw new GitHubWebhookError("missing_secret", "GITHUB_WEBHOOK_SECRET is required");
  }

  const signature = header(headers, "x-hub-signature-256");
  if (!signature.startsWith("sha256=")) {
    throw new GitHubWebhookError("invalid_signature", "Missing or malformed X-Hub-Signature-256");
  }

  const bodyBuf = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", secret).update(bodyBuf).digest("hex");
  const provided = signature.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new GitHubWebhookError("invalid_signature", "GitHub webhook signature mismatch");
  }

  const deliveryId = header(headers, "x-github-delivery");
  if (!deliveryId) {
    throw new GitHubWebhookError("missing_delivery", "X-GitHub-Delivery is required");
  }

  if (options.seenDeliveryIds?.has(deliveryId)) {
    throw new GitHubWebhookError("replay", `Duplicate GitHub delivery ${deliveryId}`);
  }

  const maxSkewMs = options.maxSkewMs ?? 5 * 60_000;
  const tsHeader = header(headers, "x-nads-timestamp") || header(headers, "x-github-webhook-timestamp");
  if (tsHeader) {
    const ts = Number(tsHeader) * (tsHeader.length <= 10 ? 1000 : 1);
    const now = options.nowMs ?? Date.now();
    if (!Number.isFinite(ts) || Math.abs(now - ts) > maxSkewMs) {
      throw new GitHubWebhookError("replay_skew", "Webhook timestamp outside allowed skew");
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(bodyBuf.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new GitHubWebhookError("invalid_json", "Webhook body is not valid JSON");
  }

  const event = header(headers, "x-github-event") || "unknown";
  const action = typeof payload.action === "string" ? payload.action : null;
  const pr = (payload.pull_request ?? null) as Record<string, unknown> | null;
  const prNumber = typeof pr?.number === "number" ? pr.number : null;
  const prUrl = typeof pr?.html_url === "string" ? pr.html_url : null;
  const head = (pr?.head ?? null) as Record<string, unknown> | null;
  const headBranch = typeof head?.ref === "string" ? head.ref : null;
  const bodyText = typeof pr?.body === "string" ? pr.body : null;
  const titleText = typeof pr?.title === "string" ? pr.title : null;
  const taskId =
    parseNadsTaskIdFromText(bodyText) ??
    parseNadsTaskIdFromText(titleText) ??
    parseNadsTaskIdFromText(headBranch);

  return {
    deliveryId,
    event,
    payload,
    taskId,
    prNumber,
    prUrl,
    headBranch,
    action,
  };
}

export function markGitHubDeliverySeen(
  seen: Set<string>,
  deliveryId: string,
  maxSize = 5000,
): void {
  seen.add(deliveryId);
  if (seen.size > maxSize) {
    const first = seen.values().next().value;
    if (first) seen.delete(first);
  }
}

/** True when this event is useful for automation completion. */
export function isAutomationCompletionEvent(verified: VerifiedGitHubWebhook): boolean {
  if (verified.event === "pull_request") {
    return ["opened", "reopened", "synchronize", "ready_for_review", "edited"].includes(
      verified.action ?? "",
    );
  }
  if (verified.event === "check_run" || verified.event === "check_suite") {
    return ["completed"].includes(verified.action ?? "");
  }
  if (verified.event === "workflow_run") {
    return ["completed"].includes(verified.action ?? "");
  }
  return false;
}
