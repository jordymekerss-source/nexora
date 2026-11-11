/**
 * Provider-agnostic Cursor Cloud Agent surface.
 * Concrete HTTP methods map 1:1 to verified docs:
 * https://prod.cursor.com/docs/cloud-agent/api/endpoints
 */

export type CursorPrompt = {
  text: string;
  images?: Array<{ data?: string; url?: string; mimeType?: string }>;
};

export type CursorGitBranch = {
  repoUrl: string;
  branch?: string;
  prUrl?: string;
};

export type CursorGitState = {
  branches?: CursorGitBranch[];
};

export type CursorAgent = {
  id: string;
  name?: string;
  status?: string;
  url?: string;
  latestRunId?: string;
  repos?: Array<{ url: string; startingRef?: string; prUrl?: string }>;
  workOnCurrentBranch?: boolean;
  autoCreatePR?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CursorRun = {
  id: string;
  agentId: string;
  status: string;
  result?: string;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
  git?: CursorGitState;
};

export type CreateAgentInput = {
  prompt: CursorPrompt;
  repos?: Array<{ url: string; startingRef?: string; prUrl?: string }>;
  model?: { id: string; params?: Array<{ id: string; value: string }> };
  name?: string;
  autoCreatePR?: boolean;
  skipReviewerRequest?: boolean;
  workOnCurrentBranch?: boolean;
  /** Idempotent create — form `bc-<uuid>`; 409 agent_id_conflict on re-POST. */
  agentId?: string;
};

export type ContinueRunInput = {
  prompt: CursorPrompt;
  /** Omit for normal follow-up. Use "steer" while a run is active. */
  delivery?: "steer";
  mode?: "agent" | "plan";
};

export type CursorStreamEvent = {
  id?: string;
  event: string;
  data: unknown;
};

export interface CursorAgentProvider {
  createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }>;
  startRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun>;
  continueRun(agentId: string, prompt: CursorPrompt, options?: ContinueRunInput): Promise<CursorRun>;
  getAgent(agentId: string): Promise<CursorAgent>;
  listRuns?(agentId: string, options?: { limit?: number }): Promise<CursorRun[]>;
  getRun(agentId: string, runId: string): Promise<CursorRun>;
  streamRun?(
    agentId: string,
    runId: string,
    options?: { lastEventId?: string; signal?: AbortSignal },
  ): AsyncIterable<CursorStreamEvent>;
  cancelRun(agentId: string, runId: string): Promise<void>;
  /** Wait until run reaches a terminal status (FINISHED/ERROR/CANCELLED/EXPIRED). */
  waitForRun?(
    agentId: string,
    runId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal },
  ): Promise<CursorRun>;
}
