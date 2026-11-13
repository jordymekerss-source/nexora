import { describe, expect, it, vi } from "vitest";
import { HttpCursorAgentProvider } from "../src/adapters/cursor-http-adapter.js";
import { CursorApiError } from "../src/adapters/cursor-errors.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpCursorAgentProvider", () => {
  it("creates an agent via POST /agents with Basic auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        agent: {
          id: "bc-1",
          status: "ACTIVE",
          latestRunId: "run-1",
        },
        run: { id: "run-1", agentId: "bc-1", status: "CREATING" },
      }),
    );

    const provider = new HttpCursorAgentProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    const created = await provider.createAgent({
      prompt: { text: "hello" },
      repos: [{ url: "https://github.com/jordymekerss-source/nexora", startingRef: "main" }],
      agentId: "bc-1",
      autoCreatePR: false,
    });

    expect(created.agent.id).toBe("bc-1");
    expect(created.run.id).toBe("run-1");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cursor.com/v1/agents");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(headers.Authorization).not.toContain("test-key");
    const body = JSON.parse(String(init.body));
    expect(body.agentId).toBe("bc-1");
    expect(body.autoCreatePR).toBe(false);
  });

  it("recovers idempotent create on 409 agent_id_conflict", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(409, { error: { code: "agent_id_conflict", message: "exists" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "bc-1",
          status: "IDLE",
          latestRunId: "run-1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "run-1",
          agentId: "bc-1",
          status: "FINISHED",
          result: "already done",
        }),
      );

    const provider = new HttpCursorAgentProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    const created = await provider.createAgent({
      prompt: { text: "hello" },
      agentId: "bc-1",
    });

    expect(created.run.status).toBe("FINISHED");
    expect(created.run.result).toBe("already done");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("surfaces authentication failures without retry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: { code: "unauthorized", message: "bad" } }));

    const provider = new HttpCursorAgentProvider({
      apiKey: "bad",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    await expect(provider.getAgent("bc-1")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces 403 without retry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(403, { error: { code: "feature_unavailable", message: "nope" } }),
      );
    const provider = new HttpCursorAgentProvider({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(provider.getRun("bc-1", "run-1")).rejects.toBeInstanceOf(CursorApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries GET on 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(429, { error: { code: "rate_limit_exceeded", message: "slow" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { id: "bc-1", status: "ACTIVE", latestRunId: "run-1" }),
      );

    const provider = new HttpCursorAgentProvider({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
      maxTransientRetries: 2,
    });

    const agent = await provider.getAgent("bc-1");
    expect(agent.id).toBe("bc-1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry POST create on 500", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: { code: "upstream_error", message: "boom" } }));

    const provider = new HttpCursorAgentProvider({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    await expect(
      provider.createAgent({ prompt: { text: "x" } }),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("handles agent_busy by waiting for latest run then retrying follow-up once", async () => {
    const fetchImpl = vi
      .fn()
      // continueRun → busy
      .mockResolvedValueOnce(
        jsonResponse(409, { error: { code: "agent_busy", message: "busy" } }),
      )
      // waitOutBusyAgent → getAgent
      .mockResolvedValueOnce(
        jsonResponse(200, { id: "bc-1", status: "ACTIVE", latestRunId: "run-old" }),
      )
      // getRun old (terminal)
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "run-old",
          agentId: "bc-1",
          status: "FINISHED",
          result: "prior",
        }),
      )
      // retry continueRun
      .mockResolvedValueOnce(
        jsonResponse(200, {
          run: { id: "run-new", agentId: "bc-1", status: "CREATING" },
        }),
      );

    const provider = new HttpCursorAgentProvider({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    const run = await provider.continueRun("bc-1", { text: "follow up" });
    expect(run.id).toBe("run-new");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("cancels a run via POST .../cancel", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "run-1" }));
    const provider = new HttpCursorAgentProvider({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.cancelRun("bc-1", "run-1");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cursor.com/v1/agents/bc-1/runs/run-1/cancel");
    expect(init.method).toBe("POST");
  });

  it("lists runs via GET /agents/{id}/runs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        items: [{ id: "run-2", agentId: "bc-1", status: "RUNNING" }],
      }),
    );
    const provider = new HttpCursorAgentProvider({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const runs = await provider.listRuns("bc-1");
    expect(runs[0]?.id).toBe("run-2");
  });

  it("parses SSE stream events and stops on result", async () => {
    const sse = [
      "event: status",
      'data: {"runId":"run-1","status":"RUNNING"}',
      "",
      "id: 1",
      "event: assistant",
      'data: {"text":"hi"}',
      "",
      "id: 2",
      "event: result",
      'data: {"runId":"run-1","status":"FINISHED","text":"done"}',
      "",
      "id: 2",
      "event: done",
      "data: {}",
      "",
    ].join("\n");

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const provider = new HttpCursorAgentProvider({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const events = [];
    for await (const event of provider.streamRun("bc-1", "run-1")) {
      events.push(event.event);
    }
    expect(events).toEqual(["status", "assistant", "result"]);
  });

  it("waitForRun falls back to polling after stream_expired (410)", async () => {
    const fetchImpl = vi
      .fn()
      // initial getRun — still running
      .mockResolvedValueOnce(
        jsonResponse(200, { id: "run-1", agentId: "bc-1", status: "RUNNING" }),
      )
      // stream → 410
      .mockResolvedValueOnce(
        jsonResponse(410, { error: { code: "stream_expired", message: "gone" } }),
      )
      // poll getRun — finished
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: "run-1",
          agentId: "bc-1",
          status: "FINISHED",
          result: "ok",
        }),
      );

    const provider = new HttpCursorAgentProvider({
      apiKey: "key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
      defaultPollIntervalMs: 1,
      defaultTimeoutMs: 5_000,
    });

    const run = await provider.waitForRun("bc-1", "run-1");
    expect(run.status).toBe("FINISHED");
    expect(run.result).toBe("ok");
  });

  it("rejects construction without API key", () => {
    expect(() => new HttpCursorAgentProvider({ apiKey: "" })).toThrow(/CURSOR_API_KEY/);
  });
});
