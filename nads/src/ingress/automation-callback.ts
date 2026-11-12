import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AutomationCallbackPayloadSchema,
  type AutomationCallbackPayload,
} from "../contracts/automation-payload.js";

export class AutomationCallbackError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AutomationCallbackError";
    this.code = code;
  }
}

/**
 * Optional signed callback endpoint for automation status updates.
 * Disabled unless secret configured; does not trigger Cursor API.
 */
export function verifyAutomationCallback(
  rawBody: string,
  headers: Record<string, string | undefined>,
  options: { secret: string; seenIds?: Set<string>; maxSkewMs?: number; nowMs?: number },
): AutomationCallbackPayload {
  const secret = options.secret.trim();
  if (!secret) {
    throw new AutomationCallbackError("missing_secret", "NADS_AUTOMATION_CALLBACK_SECRET required");
  }

  const signature = headers["x-nads-signature"] ?? headers["X-NADS-Signature"] ?? "";
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signature.replace(/^sha256=/, "");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (!provided || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AutomationCallbackError("invalid_signature", "Automation callback signature mismatch");
  }

  const tsRaw = headers["x-nads-timestamp"] ?? headers["X-NADS-Timestamp"] ?? "";
  if (tsRaw) {
    const ts = Number(tsRaw);
    const now = options.nowMs ?? Date.now();
    const skew = options.maxSkewMs ?? 5 * 60_000;
    if (!Number.isFinite(ts) || Math.abs(now - ts) > skew) {
      throw new AutomationCallbackError("replay_skew", "Callback timestamp outside allowed skew");
    }
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new AutomationCallbackError("invalid_json", "Callback body is not JSON");
  }

  const parsed = AutomationCallbackPayloadSchema.safeParse(json);
  if (!parsed.success) {
    throw new AutomationCallbackError("invalid_payload", "Callback payload failed schema validation");
  }

  const dedupeKey = `${parsed.data.taskId}:${parsed.data.executionId}:${parsed.data.status}:${parsed.data.occurredAt}`;
  if (options.seenIds?.has(dedupeKey)) {
    throw new AutomationCallbackError("replay", "Duplicate automation callback");
  }
  options.seenIds?.add(dedupeKey);

  return parsed.data;
}
