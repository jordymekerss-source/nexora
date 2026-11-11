export const TASK_STATUSES = [
  "READY",
  "CONTEXT_GATHERING",
  "PROMPT_CREATED",
  "AGENT_QUEUED",
  "AGENT_RUNNING",
  "TESTING",
  "REVIEWING",
  "REVISION_REQUIRED",
  "ACCEPTED",
  "NEXT_TASK",
  "BLOCKED",
  "STOPPED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  READY: ["CONTEXT_GATHERING", "BLOCKED", "STOPPED"],
  CONTEXT_GATHERING: ["PROMPT_CREATED", "BLOCKED", "STOPPED"],
  PROMPT_CREATED: ["AGENT_QUEUED", "BLOCKED", "STOPPED"],
  AGENT_QUEUED: ["AGENT_RUNNING", "BLOCKED", "STOPPED"],
  AGENT_RUNNING: ["TESTING", "BLOCKED", "STOPPED"],
  TESTING: ["REVIEWING", "BLOCKED", "STOPPED"],
  REVIEWING: ["ACCEPTED", "REVISION_REQUIRED", "BLOCKED", "STOPPED"],
  REVISION_REQUIRED: ["PROMPT_CREATED", "BLOCKED", "STOPPED"],
  ACCEPTED: ["NEXT_TASK", "STOPPED"],
  NEXT_TASK: ["READY", "STOPPED"],
  BLOCKED: ["STOPPED"],
  STOPPED: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal NADS transition: ${from} → ${to}`);
  }
}

export function listTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TRANSITIONS[from];
}
