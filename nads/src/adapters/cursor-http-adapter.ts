import type {
  CreateAgentInput,
  CursorAgent,
  CursorAgentProvider,
  CursorPrompt,
  CursorRun,
} from "./cursor-agent-provider.js";

/**
 * HTTP adapter for Cursor Cloud Agents API v1 (public beta).
 * Base URL default: https://api.cursor.com/v1
 */
export class HttpCursorAgentProvider implements CursorAgentProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.cursor.com/v1",
  ) {
    if (!apiKey) {
      throw new Error("CURSOR_API_KEY is required for HttpCursorAgentProvider");
    }
  }

  private authHeader(): string {
    // Docs: Basic (API key as username, empty password) or Bearer
    const basic = Buffer.from(`${this.apiKey}:`).toString("base64");
    return `Basic ${basic}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cursor API ${method} ${path} → ${response.status}: ${text.slice(0, 500)}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }> {
    // POST /v1/agents
    return this.request("POST", "/agents", {
      prompt: input.prompt,
      repos: input.repos,
      model: input.model,
      name: input.name,
      autoCreatePR: input.autoCreatePR,
    });
  }

  async startRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun> {
    return this.continueRun(agentId, prompt);
  }

  async continueRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun> {
    // POST /v1/agents/{id}/runs
    const data = await this.request<{ run: CursorRun }>("POST", `/agents/${agentId}/runs`, {
      prompt,
    });
    return data.run;
  }

  async getAgent(agentId: string): Promise<CursorAgent> {
    // GET /v1/agents/{id}
    return this.request("GET", `/agents/${agentId}`);
  }

  async getRun(agentId: string, runId: string): Promise<CursorRun> {
    // GET /v1/agents/{id}/runs/{runId}
    return this.request("GET", `/agents/${agentId}/runs/${runId}`);
  }

  async cancelRun(agentId: string, runId: string): Promise<void> {
    // POST /v1/agents/{id}/runs/{runId}/cancel
    await this.request("POST", `/agents/${agentId}/runs/${runId}/cancel`);
  }
}
