import {
  AutomationDispatchPayloadSchema,
  type AutomationDispatchPayload,
} from "../contracts/automation-payload.js";

export type AutomationDispatchResult = {
  ok: boolean;
  sent: boolean;
  status: "dispatched" | "disabled" | "rejected" | "error";
  idempotencyKey: string;
  executionId?: string;
  httpStatus?: number;
  error?: string;
};

export type AutomationExecutorOptions = {
  webhookUrl?: string;
  webhookKey?: string;
  /** Hard gate — must be true to perform network POST. Default false. */
  enabled?: boolean;
  fetchImpl?: typeof fetch;
};

/**
 * Outbound Cursor Automation webhook client.
 * Does NOT call Cloud Agents API POST /v1/agents.
 * Network send is disabled unless NADS_AUTOMATION_ENABLED=true.
 */
export class AutomationExecutor {
  private readonly webhookUrl: string;
  private readonly webhookKey: string;
  private readonly enabled: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AutomationExecutorOptions = {}) {
    this.webhookUrl = options.webhookUrl?.trim() ?? "";
    this.webhookKey = options.webhookKey?.trim() ?? "";
    this.enabled = options.enabled === true;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AutomationExecutor {
    return new AutomationExecutor({
      webhookUrl: env.NADS_AUTOMATION_WEBHOOK_URL,
      webhookKey: env.NADS_AUTOMATION_WEBHOOK_KEY,
      enabled: (env.NADS_AUTOMATION_ENABLED ?? "false").toLowerCase() === "true",
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
        error:
          "Automation enabled but NADS_AUTOMATION_WEBHOOK_URL / NADS_AUTOMATION_WEBHOOK_KEY missing — fail closed (no cursor API fallback)",
      };
    }

    try {
      const response = await this.fetchImpl(this.webhookUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.webhookKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-NADS-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
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
        // non-JSON body is acceptable; do not log raw body (may contain secrets)
      }

      if (!response.ok) {
        return {
          ok: false,
          sent: true,
          status: "error",
          idempotencyKey,
          httpStatus: response.status,
          error: `Automation webhook HTTP ${response.status}`,
        };
      }

      return {
        ok: true,
        sent: true,
        status: "dispatched",
        idempotencyKey,
        executionId,
        httpStatus: response.status,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "automation dispatch failed";
      return {
        ok: false,
        sent: false,
        status: "error",
        idempotencyKey,
        error: message.slice(0, 400),
      };
    }
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
      error: "MockAutomationExecutor — no network",
    };
  }
}
