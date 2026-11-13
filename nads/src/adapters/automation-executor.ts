import {
  AutomationDispatchPayloadSchema,
  buildAutomationWebhookBody,
  type AutomationDispatchPayload,
} from "../contracts/automation-payload.js";

export type AutomationDispatchStatus =
  | "dispatched"
  | "disabled"
  | "rejected"
  | "error"
  | "ambiguous_timeout"
  | "ambiguous_server_error"
  | "auth_error"
  | "validation_error";

export type AutomationDispatchResult = {
  ok: boolean;
  sent: boolean;
  status: AutomationDispatchStatus;
  idempotencyKey: string;
  executionId?: string;
  httpStatus?: number;
  attempts?: number;
  error?: string;
  /** True when another Automation run must not be submitted without explicit reconcile. */
  uncertain?: boolean;
};

export type AutomationExecutorOptions = {
  webhookUrl?: string;
  webhookKey?: string;
  /** Hard gate — must be true to perform network POST. Default false. */
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout (ms). Default 15_000. */
  timeoutMs?: number;
  /**
   * Extra retries after the first attempt for *pre-accept* network failures only.
   * Never used for HTTP 5xx / ambiguous server outcomes. Default 2.
   */
  maxRetries?: number;
  /** Base backoff ms before jitter. Default 250. */
  backoffMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthHttpStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function isValidationHttpStatus(status: number): boolean {
  return status === 400 || status === 404 || status === 422;
}

/** Ambiguous: request may have been accepted; Cursor has no verified idempotency guarantee. */
function isAmbiguousServerHttpStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Only classify failures that almost certainly happened before the server accepted the POST.
 * DNS / connection refused / reset before headers — safe to retry.
 * Once an HTTP status exists (including 408/429/5xx), do not retry.
 */
export function isPreAcceptNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  const message = error.message ?? "";
  if (/aborted|timeout/i.test(message)) return false;
  // fetch TypeError / undici / node network codes before response
  if (error.name === "TypeError" && /fetch failed|network/i.test(message)) return true;
  const code = (error as NodeJS.ErrnoException).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "ENETUNREACH"
  ) {
    return true;
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH|socket hang up/i.test(message)) {
    return true;
  }
  return false;
}

export function isUncertainDispatchStatus(status: string): boolean {
  return status === "ambiguous_timeout" || status === "ambiguous_server_error";
}

/**
 * Outbound Cursor Automation webhook client.
 * Does NOT call Cloud Agents API POST /v1/agents.
 * Network send is disabled unless NADS_AUTOMATION_ENABLED=true.
 *
 * Critical retry policy:
 * - Never retry after HTTP 500/502/503/504 or other ambiguous server failures
 *   (Cursor does not provide a verified idempotency guarantee for Automation POST).
 * - Retry only pre-accept network errors (connection failed before response).
 * - Timeouts → ambiguous_timeout, no retry.
 */
export class AutomationExecutor {
  private readonly webhookUrl: string;
  private readonly webhookKey: string;
  private readonly enabled: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: AutomationExecutorOptions = {}) {
    this.webhookUrl = options.webhookUrl?.trim() ?? "";
    this.webhookKey = options.webhookKey?.trim() ?? "";
    this.enabled = options.enabled === true;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = Math.max(20, options.timeoutMs ?? 15_000);
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.backoffMs = Math.max(50, options.backoffMs ?? 250);
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AutomationExecutor {
    return new AutomationExecutor({
      webhookUrl: env.NADS_AUTOMATION_WEBHOOK_URL,
      webhookKey: env.NADS_AUTOMATION_WEBHOOK_KEY,
      enabled: (env.NADS_AUTOMATION_ENABLED ?? "false").toLowerCase() === "true",
      timeoutMs: Number(env.NADS_AUTOMATION_TIMEOUT_MS ?? 15_000),
      maxRetries: Number(env.NADS_AUTOMATION_MAX_RETRIES ?? 2),
      backoffMs: Number(env.NADS_AUTOMATION_BACKOFF_MS ?? 250),
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  hasCredentials(): boolean {
    return Boolean(this.webhookUrl && this.webhookKey);
  }

  async dispatch(rawPayload: AutomationDispatchPayload): Promise<AutomationDispatchResult> {
    const payload = AutomationDispatchPayloadSchema.parse(rawPayload);
    const idempotencyKey = payload.idempotencyKey;

    if (!this.enabled) {
      return {
        ok: true,
        sent: false,
        status: "disabled",
        idempotencyKey,
        attempts: 0,
        error:
          "NADS_AUTOMATION_ENABLED is false — payload validated but not sent (prep/safe mode)",
      };
    }

    if (!this.webhookUrl || !this.webhookKey) {
      return {
        ok: false,
        sent: false,
        status: "rejected",
        idempotencyKey,
        attempts: 0,
        error:
          "Automation enabled but NADS_AUTOMATION_WEBHOOK_URL / NADS_AUTOMATION_WEBHOOK_KEY missing — fail closed (no cursor API fallback)",
      };
    }

    const body = buildAutomationWebhookBody(payload);
    const maxAttempts = this.maxRetries + 1;
    let lastError = "automation dispatch failed";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.webhookUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.webhookKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-NADS-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const text = await response.text();
        let executionId: string | undefined;
        try {
          const json = JSON.parse(text) as {
            runUuid?: string;
            backgroundComposerId?: string;
            id?: string;
          };
          executionId = json.runUuid ?? json.backgroundComposerId ?? json.id;
        } catch {
          // non-JSON body is acceptable; never log raw body
        }

        if (response.ok) {
          return {
            ok: true,
            sent: true,
            status: "dispatched",
            idempotencyKey,
            executionId,
            httpStatus: response.status,
            attempts: attempt,
          };
        }

        if (isAuthHttpStatus(response.status)) {
          return {
            ok: false,
            sent: true,
            status: "auth_error",
            idempotencyKey,
            httpStatus: response.status,
            attempts: attempt,
            error: `Automation webhook HTTP ${response.status}`,
          };
        }

        if (isValidationHttpStatus(response.status)) {
          return {
            ok: false,
            sent: true,
            status: "validation_error",
            idempotencyKey,
            httpStatus: response.status,
            attempts: attempt,
            error: `Automation webhook HTTP ${response.status}`,
          };
        }

        if (isAmbiguousServerHttpStatus(response.status)) {
          // Critical: do NOT retry — may have created a run already.
          return {
            ok: false,
            sent: true,
            status: "ambiguous_server_error",
            uncertain: true,
            idempotencyKey,
            httpStatus: response.status,
            attempts: attempt,
            error: `Automation webhook HTTP ${response.status} — not retried (ambiguous; requires explicit reconcile)`,
          };
        }

        // Other HTTP statuses (incl. 408/429): response received → do not retry.
        return {
          ok: false,
          sent: true,
          status: "error",
          idempotencyKey,
          httpStatus: response.status,
          attempts: attempt,
          error: `Automation webhook HTTP ${response.status}`,
        };
      } catch (error: unknown) {
        const name = error instanceof Error ? error.name : "";
        const message = error instanceof Error ? error.message : "automation dispatch failed";
        // Abort/timeout after the request may already have been accepted — do not retry.
        if (name === "AbortError" || /aborted|timeout/i.test(message)) {
          return {
            ok: false,
            sent: true,
            status: "ambiguous_timeout",
            uncertain: true,
            idempotencyKey,
            attempts: attempt,
            error: `Automation webhook timed out after ${this.timeoutMs}ms — not retried (ambiguous outcome)`,
          };
        }

        if (isPreAcceptNetworkError(error) && attempt < maxAttempts) {
          lastError = message.slice(0, 400);
        } else if (isPreAcceptNetworkError(error)) {
          return {
            ok: false,
            sent: false,
            status: "error",
            idempotencyKey,
            attempts: attempt,
            error: message.slice(0, 400),
          };
        } else {
          // Unknown error after possible accept — treat as uncertain, no retry.
          return {
            ok: false,
            sent: true,
            status: "ambiguous_server_error",
            uncertain: true,
            idempotencyKey,
            attempts: attempt,
            error: `Ambiguous automation dispatch failure — not retried: ${message.slice(0, 200)}`,
          };
        }
      } finally {
        clearTimeout(timer);
      }

      const jitter = Math.floor(Math.random() * this.backoffMs);
      await this.sleepImpl(this.backoffMs * 2 ** (attempt - 1) + jitter);
    }

    return {
      ok: false,
      sent: false,
      status: "error",
      idempotencyKey,
      attempts: maxAttempts,
      error: lastError,
    };
  }
}

/** Deterministic mock for unit tests / dry-run executor. */
export class MockAutomationExecutor {
  async dispatch(rawPayload: AutomationDispatchPayload): Promise<AutomationDispatchResult> {
    const payload = AutomationDispatchPayloadSchema.parse(rawPayload);
    return {
      ok: true,
      sent: false,
      status: "disabled",
      idempotencyKey: payload.idempotencyKey,
      executionId: `mock-exec-${payload.attempt}`,
      attempts: 0,
      error: "MockAutomationExecutor — no network",
    };
  }
}
