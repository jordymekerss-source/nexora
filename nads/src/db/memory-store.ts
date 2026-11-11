import { randomUUID } from "crypto";
import type { TaskStatus } from "../state-machine.js";
import { assertTransition } from "../state-machine.js";

export type DevelopmentTask = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: number;
  category: string;
  status: TaskStatus;
  acceptanceCriteria: string[];
  retryCount: number;
  maxRetries: number;
  assignedAgentId?: string;
  lastPrompt?: string;
  lastResult?: string;
};

export type DevelopmentEvent = {
  id: string;
  projectId: string;
  taskId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
};

export type ProjectSettings = {
  autonomousEnabled: boolean;
  emergencyStop: boolean;
  maxRetries: number;
  maxConcurrentAgents: number;
};

export type AgentSessionRecord = {
  id: string;
  taskId: string;
  provider: string;
  providerAgentId?: string;
  providerRunId?: string;
  branchName?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
};

export class MemoryStore {
  readonly projectId: string;
  tasks: DevelopmentTask[] = [];
  events: DevelopmentEvent[] = [];
  agentSessions: AgentSessionRecord[] = [];
  transitions: Array<{ taskId: string; from: TaskStatus; to: TaskStatus; at: string }> = [];
  settings: ProjectSettings = {
    autonomousEnabled: true,
    emergencyStop: false,
    maxRetries: 3,
    maxConcurrentAgents: 1,
  };

  constructor(projectId = randomUUID()) {
    this.projectId = projectId;
  }

  seedTask(partial: Partial<DevelopmentTask> & Pick<DevelopmentTask, "title">): DevelopmentTask {
    const task: DevelopmentTask = {
      id: randomUUID(),
      projectId: this.projectId,
      description: partial.description ?? "",
      priority: partial.priority ?? 10,
      category: partial.category ?? "P0",
      status: partial.status ?? "READY",
      acceptanceCriteria: partial.acceptanceCriteria ?? [],
      retryCount: 0,
      maxRetries: this.settings.maxRetries,
      ...partial,
      title: partial.title,
    };
    this.tasks.push(task);
    return task;
  }

  nextReadyTask(): DevelopmentTask | null {
    return (
      this.tasks
        .filter((task) => task.status === "READY")
        .sort((a, b) => a.priority - b.priority)[0] ?? null
    );
  }

  transition(taskId: string, to: TaskStatus, reason?: string): DevelopmentTask {
    const task = this.tasks.find((row) => row.id === taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    assertTransition(task.status, to);
    const from = task.status;
    task.status = to;
    this.transitions.push({
      taskId,
      from,
      to,
      at: new Date().toISOString(),
    });
    this.appendEvent({
      taskId,
      eventType: "task.transition",
      payload: { from, to, reason: reason ?? null },
      idempotencyKey: `${taskId}:${from}:${to}:${this.transitions.length}`,
    });
    return task;
  }

  appendEvent(input: {
    taskId?: string;
    eventType: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }): DevelopmentEvent | null {
    if (this.events.some((event) => event.idempotencyKey === input.idempotencyKey)) {
      return null;
    }
    const event: DevelopmentEvent = {
      id: randomUUID(),
      projectId: this.projectId,
      taskId: input.taskId,
      eventType: input.eventType,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }

  recordAgentSession(input: {
    taskId: string;
    providerAgentId?: string;
    providerRunId?: string;
    branchName?: string;
    status: string;
  }): AgentSessionRecord {
    const record: AgentSessionRecord = {
      id: randomUUID(),
      taskId: input.taskId,
      provider: "cursor",
      providerAgentId: input.providerAgentId,
      providerRunId: input.providerRunId,
      branchName: input.branchName,
      status: input.status,
      startedAt: new Date().toISOString(),
      finishedAt: ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(input.status)
        ? new Date().toISOString()
        : undefined,
    };
    this.agentSessions.push(record);
    return record;
  }
}
