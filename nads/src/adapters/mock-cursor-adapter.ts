import { randomUUID } from "crypto";
import type {
  CreateAgentInput,
  CursorAgent,
  CursorAgentProvider,
  CursorPrompt,
  CursorRun,
} from "./cursor-agent-provider.js";

/**
 * Deterministic mock for dry-run / unit tests.
 * First run result contains a planted failure marker; continueRun clears it.
 */
export class MockCursorAgentProvider implements CursorAgentProvider {
  private agents = new Map<string, CursorAgent>();
  private runs = new Map<string, CursorRun>();
  private failFirst = true;

  async createAgent(input: CreateAgentInput): Promise<{ agent: CursorAgent; run: CursorRun }> {
    const agentId = `bc-mock-${randomUUID()}`;
    const runId = `run-mock-${randomUUID()}`;
    const agent: CursorAgent = {
      id: agentId,
      name: input.name ?? "mock-agent",
      status: "ACTIVE",
      latestRunId: runId,
      repos: input.repos,
    };
    const run: CursorRun = {
      id: runId,
      agentId,
      status: "FINISHED",
      result: this.failFirst
        ? `MOCK_IMPLANT_FAIL: ${input.prompt.text.slice(0, 120)}`
        : `MOCK_OK: ${input.prompt.text.slice(0, 120)}`,
      durationMs: 10,
    };
    this.failFirst = false;
    this.agents.set(agentId, agent);
    this.runs.set(runId, run);
    return { agent, run };
  }

  async startRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun> {
    return this.continueRun(agentId, prompt);
  }

  async continueRun(agentId: string, prompt: CursorPrompt): Promise<CursorRun> {
    if (!this.agents.has(agentId)) {
      throw new Error(`Unknown agent ${agentId}`);
    }
    const runId = `run-mock-${randomUUID()}`;
    const run: CursorRun = {
      id: runId,
      agentId,
      status: "FINISHED",
      result: `MOCK_RECOVERY_OK: ${prompt.text.slice(0, 120)}`,
      durationMs: 8,
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

  async getRun(_agentId: string, runId: string): Promise<CursorRun> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    return run;
  }

  async cancelRun(_agentId: string, runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run) run.status = "CANCELLED";
  }
}
