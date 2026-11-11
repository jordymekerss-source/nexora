/**
 * Typed Cursor Cloud Agents API errors.
 * Error body shape from docs: `{ "error": { "code": "...", "message": "..." } }`.
 */

export class CursorApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly method: string;
  readonly path: string;

  constructor(input: {
    status: number;
    code?: string | null;
    message: string;
    method: string;
    path: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "CursorApiError";
    this.status = input.status;
    this.code = input.code ?? null;
    this.method = input.method;
    this.path = input.path;
    this.retryable =
      input.retryable ??
      isRetryableCursorStatus(input.status, input.method, input.code ?? null);
  }
}

export function isRetryableCursorStatus(
  status: number,
  method: string,
  code: string | null,
): boolean {
  // Never treat auth / validation / conflict as transient success-path retries.
  if (status === 400 || status === 401 || status === 403 || status === 404) return false;
  if (status === 409) {
    // Conflicts need explicit orchestration (idempotent recover / wait / cancel).
    return false;
  }
  if (status === 410) return false; // stream_expired → fall back to GET run
  if (status === 429) return true;
  if (status >= 500 && status <= 599) {
    // Safe to retry idempotent GETs. POSTs that may have reached the agent are NOT retryable.
    return method.toUpperCase() === "GET";
  }
  return false;
}

export function parseCursorErrorBody(text: string): { code: string | null; message: string } {
  try {
    const json = JSON.parse(text) as {
      error?: { code?: string; message?: string };
      message?: string;
      code?: string;
    };
    const code = json.error?.code ?? json.code ?? null;
    const message = json.error?.message ?? json.message ?? text;
    return { code, message: String(message).slice(0, 500) };
  } catch {
    return { code: null, message: text.slice(0, 500) };
  }
}

export const ACTIVE_RUN_STATUSES = new Set([
  "CREATING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
]);

export const TERMINAL_RUN_STATUSES = new Set([
  "FINISHED",
  "ERROR",
  "CANCELLED",
  "EXPIRED",
]);

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function isActiveRunStatus(status: string): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}
