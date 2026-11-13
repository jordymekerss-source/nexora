import { HttpCursorAgentProvider } from "./cursor-http-adapter.js";
import type { CursorAgentProvider } from "./cursor-agent-provider.js";
import { MockCursorAgentProvider } from "./mock-cursor-adapter.js";

/**
 * @deprecated Prefer createExecutorFromEnv() with NADS_EXECUTOR.
 *
 * Explicit Cursor Cloud Agents API provider resolution ONLY.
 * Must never be used as an automatic fallback from the automation executor.
 *
 * - dry-run → MockCursorAgentProvider
 * - live without CURSOR_API_KEY → fail closed
 * - live with key → HttpCursorAgentProvider (may hit prepaid-gated POST /v1/agents)
 */
export function createCursorProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CursorAgentProvider {
  const mode = (env.NADS_MODE ?? "dry-run").toLowerCase();

  if (mode === "dry-run") {
    return new MockCursorAgentProvider();
  }

  if (mode === "live") {
    const apiKey = env.CURSOR_API_KEY?.trim() ?? "";
    if (!apiKey) {
      throw new Error(
        "NADS_MODE=live requires CURSOR_API_KEY — refusing to start (fail closed, no mock fallback)",
      );
    }
    return new HttpCursorAgentProvider({
      apiKey,
      baseUrl: env.CURSOR_API_BASE_URL?.trim() || "https://api.cursor.com/v1",
      defaultPollIntervalMs: Number(env.NADS_POLL_INTERVAL_MS ?? 5_000),
      defaultTimeoutMs: Number(env.NADS_RUN_TIMEOUT_MS ?? 30 * 60_000),
    });
  }

  throw new Error(`Unknown NADS_MODE="${mode}". Use dry-run | live.`);
}

/** Client-supplied Cursor agent id for idempotent create (`bc-<uuid>`). */
export function cursorAgentIdForTask(taskId: string): string {
  const uuid = taskId.replace(/^bc-/, "");
  return `bc-${uuid}`;
}
