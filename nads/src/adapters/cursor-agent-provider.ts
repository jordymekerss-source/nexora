/**
 * Provider-agnostic Cursor Cloud Agent surface.
 * Concrete HTTP methods map 1:1 to verified docs:
 * https://cursor.com/docs/cloud-agent/api/endpoints
 */

export type CursorPrompt = {
  text: string;
  images?: Array<{ data?: string; url?: string; mimeType?: string }>;
};

export type CursorAgent = {
  id: string;
  name?: string;
  status?: string;
  url?: string;
  latestRunId?: string;
  repos?: Array<{ url: string; startingRef?: string }>;
};

export type CursorRun = {
  id: string;
  agentId: string;
  status: string;
  result?: string;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
  git?: unknown;
};

export type CreateAgentInput = {
  prompt: CursorPrompt;
  repos?: Array<{ url: string; startingRef?: string }>;
  model?: { id: string; params?: Array<{ id: string; value: string }> };
  name?: string;
  autoCreatePR?: boolean;
};

export interface CursorAgentProvider {
  createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }>;
  startRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun>;
  continueRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun>;
  getAgent(agentId: string): Promise<CursorAgent>;
  getRun(agentId: string, runId: string): Promise<CursorRun>;
  getRunEvents?(agentId: string, runId: string): AsyncIterable<unknown>;
  cancelRun(agentId: string, runId: string): Promise<void>;
}
