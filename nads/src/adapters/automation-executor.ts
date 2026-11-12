import {
  AutomationDispatchPayloadSchema,
  buildAutomationWebhookBody,
  type AutomationDispatchPayload,
} from "../contracts/automation-payload.js";

export type AutomationDispatchResult = {
  ok: boolean;
  sent: boolean;
  status:
    | "dispatched"
    | "disabled"
    | "rejected"
    | "error"
    | "ambiguous_timeout"
    | "auth_error"
    | "validation_error";
  idempotencyKey: string;
  executionId?: string;
  httpStatus?: number;
  attempts?: number;
  error?: string;
};

export type AutomationExecutorOptions = {
  webhookUrl?: string;
  webhookKey?: string;
  /** Hard gate — must be true to perform network POST. Default false. */
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout (ms). Default 15_000. */
  timeoutMs?: number;
  /** Extra retries after the first attempt for transient failures only. Default 2. */
  maxRetries?: number;
  /** Base backoff ms before jitter. Default 250. */
  backoffMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isAuthHttpStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function isValidationHttpStatus(status: number): boolean {
  return status === 400 || status === 404 || status === 422;
}

/**
 * Outbound Cursor Automation webhook client.
 * Does NOT call Cloud Agents API POST /v1/agents.
 * Network send is disabled unless NADS_AUTOMATION_ENABLED=true.
 *
 * Retries are bounded and skip auth/validation/ambiguous-timeout outcomes
 * so we do not invent duplicate Automation runs.
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

        lastError = `Automation webhook HTTP ${response.status}`;
        if (!isRetryableHttpStatus(response.status) || attempt >= maxAttempts) {
          return {
            ok: false,
            sent: true,
            status: "error",
            idempotencyKey,
            httpStatus: response.status,
            attempts: attempt,
            error: lastError,
          };
        }
      } catch (error: unknown) {
        const name = error instanceof Error ? error.name : "";
        const message = error instanceof Error ? error.message : "automation dispatch failed";
        // Abort/timeout after the request may already have been accepted — do not retry.
        if (name === "AbortError" || /aborted|timeout/i.test(message)) {
          return {
            ok: false,
            sent: true,
            status: "ambiguous_timeout",
            idempotencyKey,
            attempts: attempt,
            error: `Automation webhook timed out after ${this.timeoutMs}ms — not retried (ambiguous outcome)`,
          };
        }
        lastError = message.slice(0, 400);
        if (attempt >= maxAttempts) {
          return {
            ok: false,
            sent: false,
            status: "error",
            idempotencyKey,
            attempts: attempt,
            error: lastError,
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
