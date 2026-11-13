import { randomUUID } from "crypto";
import type {
  ContinueRunInput,
  CreateAgentInput,
  CursorAgent,
  CursorAgentProvider,
  CursorPrompt,
  CursorRun,
  CursorStreamEvent,
} from "./cursor-agent-provider.js";
import { CursorApiError } from "./cursor-errors.js";

/**
 * Deterministic mock for dry-run / unit tests.
 * First run result contains a planted failure marker; continueRun clears it.
 */
export class MockCursorAgentProvider implements CursorAgentProvider {
  private agents = new Map<string, CursorAgent>();
  private runs = new Map<string, CursorRun>();
  private failFirst = true;
  private busyAgentIds = new Set<string>();

  /** Test helper: next continueRun without steer returns 409 agent_busy once. */
  markBusyOnce(agentId: string): void {
    this.busyAgentIds.add(agentId);
  }

  async createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }> {
    if (input.agentId && this.agents.has(input.agentId)) {
      throw new CursorApiError({
        status: 409,
        code: "agent_id_conflict",
        message: "agent_id_conflict",
        method: "POST",
        path: "/agents",
      });
    }

    const agentId = input.agentId ?? `bc-mock-${randomUUID()}`;
    const runId = `run-mock-${randomUUID()}`;
    const agent: CursorAgent = {
      id: agentId,
      name: input.name ?? "mock-agent",
      status: "ACTIVE",
      latestRunId: runId,
      repos: input.repos,
      autoCreatePR: input.autoCreatePR,
      workOnCurrentBranch: input.workOnCurrentBranch ?? false,
    };
    const run: CursorRun = {
      id: runId,
      agentId,
      status: "FINISHED",
      result: this.failFirst
        ? `MOCK_IMPLANT_FAIL: ${input.prompt.text.slice(0, 120)}`
        : `MOCK_OK: ${input.prompt.text.slice(0, 120)}`,
      durationMs: 10,
      git: {
        branches: [
          {
            repoUrl: "github.com/jordymekerss-source/nexora",
            branch: "cursor/mock-nads-branch",
            prUrl: input.autoCreatePR
              ? "https://github.com/jordymekerss-source/nexora/pull/999"
              : undefined,
          },
        ],
      },
    };
    this.failFirst = false;
    this.agents.set(agentId, agent);
    this.runs.set(runId, run);
    return { agent, run };
  }

  async startRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun> {
    return this.continueRun(agentId, prompt);
  }

  async continueRun(
    agentId: string,
    prompt: CursorPrompt,
    options?: ContinueRunInput,
  ): Promise<CursorRun> {
    if (!this.agents.has(agentId)) {
      throw new Error(`Unknown agent ${agentId}`);
    }

    if (this.busyAgentIds.has(agentId) && options?.delivery !== "steer") {
      this.busyAgentIds.delete(agentId);
      throw new CursorApiError({
        status: 409,
        code: "agent_busy",
        message: "agent_busy",
        method: "POST",
        path: `/agents/${agentId}/runs`,
      });
    }

    const runId = `run-mock-${randomUUID()}`;
    const run: CursorRun = {
      id: runId,
      agentId,
      status: "FINISHED",
      result: `MOCK_RECOVERY_OK: ${(options?.prompt ?? prompt).text.slice(0, 120)}`,
      durationMs: 8,
      git: {
        branches: [
          {
            repoUrl: "github.com/jordymekerss-source/nexora",
            branch: "cursor/mock-nads-branch",
          },
        ],
      },
    };
    this.runs.set(runId, run);
    const agent = this.agents.get(agentId)!;
    agent.latestRunId = runId;
    return run;
  }

  async getAgent(agentId: string): Promise<CursorAgent> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent ${agentId}`);
    return agent;
  }

  async listRuns(agentId: string): Promise<CursorRun[]> {
    return [...this.runs.values()].filter((run) => run.agentId === agentId);
  }

  async getRun(_agentId: string, runId: string): Promise<CursorRun> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    return run;
  }

  async *streamRun(
    _agentId: string,
    runId: string,
  ): AsyncGenerator<CursorStreamEvent> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    yield { event: "status", data: { runId, status: run.status } };
    yield {
      id: "1",
      event: "result",
      data: {
        runId,
        status: run.status,
        text: run.result,
        durationMs: run.durationMs,
        git: run.git,
      },
    };
    yield { id: "1", event: "done", data: {} };
  }

  async waitForRun(agentId: string, runId: string): Promise<CursorRun> {
    return this.getRun(agentId, runId);
  }

  async cancelRun(_agentId: string, runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run) run.status = "CANCELLED";
  }
}
