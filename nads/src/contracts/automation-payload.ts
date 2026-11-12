import { z } from "zod";

/** Outbound dynamic task payload posted to a Cursor Automation webhook. */
export const AutomationDispatchPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().uuid(),
  title: z.string().min(1).max(200),
  prompt: z.string().min(1),
  acceptanceCriteria: z.array(z.string()),
  attempt: z.number().int().min(1).max(10),
  maxAttempts: z.number().int().min(1).max(10),
  correlation: z.object({
    nadsTaskMarker: z.string().min(1),
    branchPrefix: z.string().min(1),
    projectId: z.string().optional(),
  }),
  priorRejection: z.string().nullable(),
  requiredChanges: z.array(z.string()).default([]),
  repoUrl: z.string().url(),
  startingRef: z.string().min(1),
  dispatchedAt: z.string().datetime(),
  idempotencyKey: z.string().min(8),
});

export type AutomationDispatchPayload = z.infer<typeof AutomationDispatchPayloadSchema>;

/** Optional inbound status callback from an automation/orchestrator bridge. */
export const AutomationCallbackPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().uuid(),
  executionId: z.string().min(1),
  status: z.enum(["accepted", "running", "succeeded", "failed", "blocked"]),
  branchName: z.string().nullable().optional(),
  prUrl: z.string().url().nullable().optional(),
  prNumber: z.number().int().positive().nullable().optional(),
  error: z.string().nullable().optional(),
  occurredAt: z.string().datetime(),
});

export type AutomationCallbackPayload = z.infer<typeof AutomationCallbackPayloadSchema>;

export function nadsTaskMarker(taskId: string): string {
  return `nads-task:${taskId}`;
}

export function nadsBranchPrefix(taskId: string): string {
  const short = taskId.replace(/-/g, "").slice(0, 10);
  return `cursor/nads-${short}`;
}

export function parseNadsTaskIdFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/nads-task:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i);
  return match?.[1] ?? null;
}
