import type {
  ContinueRunInput,
  CreateAgentInput,
  CursorAgent,
  CursorAgentProvider,
  CursorPrompt,
  CursorRun,
  CursorStreamEvent,
} from "./cursor-agent-provider.js";
import {
  CursorApiError,
  isActiveRunStatus,
  isTerminalRunStatus,
  parseCursorErrorBody,
} from "./cursor-errors.js";

export type HttpCursorAgentProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Max retries for safe/transient GET (and 429) requests. */
  maxTransientRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  defaultPollIntervalMs?: number;
  defaultTimeoutMs?: number;
};

type SteerResponse = {
  delivery: "steered" | "queued";
  runId?: string;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Production HTTP adapter for Cursor Cloud Agents API v1 (public beta).
 * Docs: https://prod.cursor.com/docs/cloud-agent/api/endpoints
 *
 * Auth: Basic (API key as username, empty password) — matches official curl `-u KEY:`.
 * Bearer is also accepted by the API; we use Basic as documented in examples.
 *
 * Critical safety: POST create/follow-up are NOT blindly retried on network errors,
 * because the request may already have reached the agent (docs: steer retries can
 * double-deliver). Use client-supplied `agentId` for idempotent create recovery.
 */
export class HttpCursorAgentProvider implements CursorAgentProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxTransientRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly defaultPollIntervalMs: number;
  private readonly defaultTimeoutMs: number;

  constructor(options: HttpCursorAgentProviderOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("CURSOR_API_KEY is required for HttpCursorAgentProvider");
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? "https://api.cursor.com/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxTransientRetries = options.maxTransientRetries ?? 3;
    this.sleep = options.sleep ?? defaultSleep;
    this.defaultPollIntervalMs = options.defaultPollIntervalMs ?? 5_000;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30 * 60_000;
  }

  private authHeader(): string {
    const basic = Buffer.from(`${this.apiKey}:`).toString("base64");
    return `Basic ${basic}`;
  }

  private async rawRequest(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader(),
        Accept: extraHeaders?.Accept ?? "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { allowRetry?: boolean },
  ): Promise<T> {
    const allowRetry = options?.allowRetry ?? method.toUpperCase() === "GET";
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= (allowRetry ? this.maxTransientRetries : 0)) {
      attempt += 1;
      try {
        const response = await this.rawRequest(method, path, body);
        if (response.status === 204) {
          return undefined as T;
        }

        const text = await response.text();
        if (!response.ok) {
          const parsed = parseCursorErrorBody(text);
          const error = new CursorApiError({
            status: response.status,
            code: parsed.code,
            message: `Cursor API ${method} ${path} → ${response.status}${
              parsed.code ? ` (${parsed.code})` : ""
            }: ${parsed.message}`,
            method,
            path,
          });
          if (allowRetry && error.retryable && attempt <= this.maxTransientRetries) {
            const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1));
            await this.sleep(backoff);
            lastError = error;
            continue;
          }
          throw error;
        }

        if (!text) {
          return undefined as T;
        }
        return JSON.parse(text) as T;
      } catch (error: unknown) {
        if (error instanceof CursorApiError) {
          throw error;
        }
        // Network / parse failures: only retry GETs. POSTs may have reached the agent.
        lastError = error;
        if (!allowRetry || attempt > this.maxTransientRetries) {
          throw error;
        }
        const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1));
        await this.sleep(backoff);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Cursor request failed");
  }

  /**
   * POST /v1/agents
   * On 409 agent_id_conflict with a client agentId, recover via GET /v1/agents/{id}.
   */
  async createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }> {
    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      repos: input.repos,
      model: input.model,
      name: input.name,
      autoCreatePR: input.autoCreatePR,
      skipReviewerRequest: input.skipReviewerRequest,
      workOnCurrentBranch: input.workOnCurrentBranch,
    };
    if (input.agentId) {
      payload.agentId = input.agentId;
    }

    try {
      return await this.requestJson<{ agent: CursorAgent; run: CursorRun }>(
        "POST",
        "/agents",
        payload,
        { allowRetry: false },
      );
    } catch (error: unknown) {
      if (
        error instanceof CursorApiError &&
        error.status === 409 &&
        error.code === "agent_id_conflict" &&
        input.agentId
      ) {
        return this.recoverFromAgentIdConflict(input.agentId);
      }
      throw error;
    }
  }

  private async recoverFromAgentIdConflict(
    agentId: string,
  ): Promise<{ agent: CursorAgent; run: CursorRun }> {
    const agent = await this.getAgent(agentId);
    if (!agent.latestRunId) {
      const runs = await this.listRuns(agentId, { limit: 1 });
      const run = runs[0];
      if (!run) {
        throw new CursorApiError({
          status: 409,
          code: "agent_id_conflict",
          message: `agent_id_conflict for ${agentId} but no runs found to recover`,
          method: "POST",
          path: "/agents",
        });
      }
      return { agent, run };
    }
    const run = await this.getRun(agentId, agent.latestRunId);
    return { agent, run };
  }

  async startRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun> {
    return this.continueRun(agentId, prompt);
  }

  /**
   * POST /v1/agents/{id}/runs
   * Handles 409 agent_busy by waiting for the active run to terminate, then retrying once.
   * Does not auto-retry network failures (may have already been accepted).
   */
  async continueRun(
    agentId: string,
    prompt: CursorPrompt,
    options?: ContinueRunInput,
  ): Promise<CursorRun> {
    const body: Record<string, unknown> = {
      prompt: options?.prompt ?? prompt,
    };
    if (options?.delivery) body.delivery = options.delivery;
    if (options?.mode) body.mode = options.mode;

    try {
      if (options?.delivery === "steer") {
        const steered = await this.requestJson<SteerResponse>(
          "POST",
          `/agents/${agentId}/runs`,
          body,
          { allowRetry: false },
        );
        if (steered.runId) {
          return this.getRun(agentId, steered.runId);
        }
        const agent = await this.getAgent(agentId);
        if (agent.latestRunId) {
          return this.getRun(agentId, agent.latestRunId);
        }
        throw new Error("Steer accepted but no runId available yet");
      }

      const data = await this.requestJson<{ run: CursorRun }>(
        "POST",
        `/agents/${agentId}/runs`,
        body,
        { allowRetry: false },
      );
      return data.run;
    } catch (error: unknown) {
      if (
        error instanceof CursorApiError &&
        error.status === 409 &&
        error.code === "agent_busy" &&
        options?.delivery !== "steer"
      ) {
        await this.waitOutBusyAgent(agentId);
        const data = await this.requestJson<{ run: CursorRun }>(
          "POST",
          `/agents/${agentId}/runs`,
          body,
          { allowRetry: false },
        );
        return data.run;
      }
      throw error;
    }
  }

  private async waitOutBusyAgent(agentId: string): Promise<void> {
    const agent = await this.getAgent(agentId);
    const runId = agent.latestRunId;
    if (!runId) {
      // No known run — brief backoff then let caller retry once.
      await this.sleep(this.defaultPollIntervalMs);
      return;
    }
    const run = await this.getRun(agentId, runId);
    if (isActiveRunStatus(run.status)) {
      await this.waitForRun(agentId, runId, {
        timeoutMs: this.defaultTimeoutMs,
        pollIntervalMs: this.defaultPollIntervalMs,
      });
    }
  }

  /** GET /v1/agents/{id} */
  async getAgent(agentId: string): Promise<CursorAgent> {
    return this.requestJson<CursorAgent>("GET", `/agents/${agentId}`);
  }

  /** GET /v1/agents/{id}/runs */
  async listRuns(agentId: string, options?: { limit?: number }): Promise<CursorRun[]> {
    const limit = options?.limit ?? 20;
    const data = await this.requestJson<{ items: CursorRun[] }>(
      "GET",
      `/agents/${agentId}/runs?limit=${limit}`,
    );
    return data.items ?? [];
  }

  /** GET /v1/agents/{id}/runs/{runId} */
  async getRun(agentId: string, runId: string): Promise<CursorRun> {
    return this.requestJson<CursorRun>("GET", `/agents/${agentId}/runs/${runId}`);
  }

  /**
   * GET /v1/agents/{id}/runs/{runId}/stream
   * Reconnects with Last-Event-ID after network interruption.
   * On 410 stream_expired, stops streaming (caller should GET run).
   */
  async *streamRun(
    agentId: string,
    runId: string,
    options?: { lastEventId?: string; signal?: AbortSignal },
  ): AsyncGenerator<CursorStreamEvent> {
    let lastEventId = options?.lastEventId;
    let reconnects = 0;

    while (reconnects <= this.maxTransientRetries) {
      if (options?.signal?.aborted) {
        throw new Error("stream aborted");
      }

      let response: Response;
      try {
        response = await this.rawRequest("GET", `/agents/${agentId}/runs/${runId}/stream`, undefined, {
          Accept: "text/event-stream",
          ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
        });
      } catch {
        reconnects += 1;
        await this.sleep(Math.min(30_000, 500 * 2 ** reconnects));
        continue;
      }

      if (response.status === 410) {
        // Retention elapsed — fall back to polling via waitForRun.
        return;
      }

      if (!response.ok) {
        const text = await response.text();
        const parsed = parseCursorErrorBody(text);
        throw new CursorApiError({
          status: response.status,
          code: parsed.code,
          message: `Cursor stream → ${response.status}: ${parsed.message}`,
          method: "GET",
          path: `/agents/${agentId}/runs/${runId}/stream`,
        });
      }

      if (!response.body) {
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamEnded = false;

      try {
        while (!streamEnded) {
          if (options?.signal?.aborted) {
            throw new Error("stream aborted");
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const event = parseSseChunk(chunk);
            if (!event) continue;
            if (event.id) lastEventId = event.id;
            yield event;
            if (event.event === "done" || event.event === "result") {
              streamEnded = true;
              break;
            }
            if (event.event === "error") {
              streamEnded = true;
              break;
            }
          }
        }
      } catch {
        reconnects += 1;
        await this.sleep(Math.min(30_000, 500 * 2 ** reconnects));
        continue;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // ignore
        }
      }

      if (streamEnded) return;
      // Incomplete disconnect — reconnect with Last-Event-ID.
      reconnects += 1;
      await this.sleep(Math.min(30_000, 500 * 2 ** reconnects));
    }
  }

  /** POST /v1/agents/{id}/runs/{runId}/cancel */
  async cancelRun(agentId: string, runId: string): Promise<void> {
    await this.requestJson<{ id: string }>(
      "POST",
      `/agents/${agentId}/runs/${runId}/cancel`,
      undefined,
      { allowRetry: false },
    );
  }

  /**
   * Prefer SSE; on stream failure/expiry fall back to polling GET run.
   */
  async waitForRun(
    agentId: string,
    runId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal },
  ): Promise<CursorRun> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const pollIntervalMs = options?.pollIntervalMs ?? this.defaultPollIntervalMs;
    const started = Date.now();

    // Fast path: already terminal.
    let current = await this.getRun(agentId, runId);
    if (isTerminalRunStatus(current.status)) {
      return current;
    }

    // Try SSE until result/done or stream unavailable.
    try {
      for await (const event of this.streamRun(agentId, runId, { signal: options?.signal })) {
        if (options?.signal?.aborted) throw new Error("waitForRun aborted");
        if (Date.now() - started > timeoutMs) {
          throw new Error(`Timed out waiting for Cursor run ${runId}`);
        }
        if (event.event === "result") {
          const data = event.data as {
            status?: string;
            text?: string;
            durationMs?: number;
            git?: CursorRun["git"];
          };
          current = await this.getRun(agentId, runId);
          if (data?.text && !current.result) {
            current = { ...current, result: data.text };
          }
          if (isTerminalRunStatus(current.status)) {
            return current;
          }
        }
        if (event.event === "status") {
          const data = event.data as { status?: string };
          if (data?.status && isTerminalRunStatus(data.status)) {
            return this.getRun(agentId, runId);
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof CursorApiError && (error.status === 401 || error.status === 403)) {
        throw error;
      }
      // Fall through to polling for stream interruptions / 410.
    }

    while (Date.now() - started <= timeoutMs) {
      if (options?.signal?.aborted) throw new Error("waitForRun aborted");
      current = await this.getRun(agentId, runId);
      if (isTerminalRunStatus(current.status)) {
        return current;
      }
      await this.sleep(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for Cursor run ${runId} after ${timeoutMs}ms`);
  }
}

function parseSseChunk(chunk: string): CursorStreamEvent | null {
  const lines = chunk.split("\n");
  let id: string | undefined;
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0 && !id) return null;
  const raw = dataLines.join("\n");
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = raw;
  }
  return { id, event, data };
}
