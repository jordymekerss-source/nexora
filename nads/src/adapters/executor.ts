import type { AutomationDispatchPayload } from "../contracts/automation-payload.js";
import {
  AutomationExecutor,
  MockAutomationExecutor,
  type AutomationDispatchResult,
} from "./automation-executor.js";
import { HttpCursorAgentProvider } from "./cursor-http-adapter.js";
import type { CursorAgentProvider } from "./cursor-agent-provider.js";
import { MockCursorAgentProvider } from "./mock-cursor-adapter.js";

export type ExecutorKind = "automation" | "cursor" | "mock";

export type DispatchInput = {
  payload: AutomationDispatchPayload;
};

/**
 * Preferred execution surface for NADS.
 * - automation: Cursor Automation webhook (no /v1/agents)
 * - cursor: explicit optional HttpCursorAgentProvider (prepaid-gated API)
 * - mock: tests / dry-run
 */
export interface TaskExecutor {
  readonly kind: ExecutorKind;
  dispatch(input: DispatchInput): Promise<AutomationDispatchResult>;
  /** Only set for kind=cursor — never used as silent fallback. */
  cursorProvider?: CursorAgentProvider;
}

class AutomationTaskExecutor implements TaskExecutor {
  readonly kind = "automation" as const;
  constructor(private readonly inner: AutomationExecutor) {}
  dispatch(input: DispatchInput): Promise<AutomationDispatchResult> {
    return this.inner.dispatch(input.payload);
  }
}

class CursorTaskExecutor implements TaskExecutor {
  readonly kind = "cursor" as const;
  readonly cursorProvider: CursorAgentProvider;
  constructor(provider: CursorAgentProvider) {
    this.cursorProvider = provider;
  }
  async dispatch(): Promise<AutomationDispatchResult> {
    throw new Error(
      "NADS_EXECUTOR=cursor does not use AutomationExecutor.dispatch — use HttpCursorAgentProvider explicitly in the cursor loop path",
    );
  }
}

class MockTaskExecutor implements TaskExecutor {
  readonly kind = "mock" as const;
  private readonly inner = new MockAutomationExecutor();
  readonly cursorProvider = new MockCursorAgentProvider();
  dispatch(input: DispatchInput): Promise<AutomationDispatchResult> {
    return this.inner.dispatch(input.payload);
  }
}

/**
 * Resolve preferred executor.
 *
 * Rules:
 * - Default / mock → MockTaskExecutor (no network)
 * - automation → AutomationExecutor (send still gated by NADS_AUTOMATION_ENABLED)
 * - cursor → HttpCursorAgentProvider only when explicitly requested + key present
 * - NEVER fall back from automation → cursor on missing secrets or failures
 */
export function createExecutorFromEnv(env: NodeJS.ProcessEnv = process.env): TaskExecutor {
  const raw = (env.NADS_EXECUTOR ?? "mock").trim().toLowerCase();
  const kind = raw === "cursor_api" ? "cursor" : raw;

  if (kind === "mock" || kind === "dry-run") {
    return new MockTaskExecutor();
  }

  if (kind === "automation") {
    return new AutomationTaskExecutor(AutomationExecutor.fromEnv(env));
  }

  if (kind === "cursor") {
    const apiKey = env.CURSOR_API_KEY?.trim() ?? "";
    if (!apiKey) {
      throw new Error(
        'NADS_EXECUTOR=cursor requires CURSOR_API_KEY — fail closed (automation is preferred; no silent mock)',
      );
    }
    return new CursorTaskExecutor(
      new HttpCursorAgentProvider({
        apiKey,
        baseUrl: env.CURSOR_API_BASE_URL?.trim() || "https://api.cursor.com/v1",
        defaultPollIntervalMs: Number(env.NADS_POLL_INTERVAL_MS ?? 5_000),
        defaultTimeoutMs: Number(env.NADS_RUN_TIMEOUT_MS ?? 30 * 60_000),
      }),
    );
  }

  throw new Error(`Unknown NADS_EXECUTOR="${raw}". Use automation | cursor | mock`);
}

export function assertNoAutomaticCursorFallback(
  preferred: ExecutorKind,
  resolved: ExecutorKind,
): void {
  if (preferred === "automation" && resolved === "cursor") {
    throw new Error("Refusing automatic fallback from automation executor to cursor API");
  }
}
