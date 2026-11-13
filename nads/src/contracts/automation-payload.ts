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

/**
 * Markdown brief placed in Automation webhook `context`.
 * Cursor Automations inject `context` into the agent prompt; nested JSON alone is not reliable.
 */
export function buildAutomationComposerContext(payload: AutomationDispatchPayload): string {
  const lines = [
    "# NADS Automation task brief",
    "",
    `Task ID: ${payload.taskId}`,
    `Correlation marker (required in PR body): ${payload.correlation.nadsTaskMarker}`,
    `Title: ${payload.title}`,
    "",
    "## Repository",
    `- URL: ${payload.repoUrl}`,
    `- Starting ref: ${payload.startingRef}`,
    `- Preferred branch prefix: ${payload.correlation.branchPrefix}`,
    "",
    "## Attempt",
    `- Attempt: ${payload.attempt} / ${payload.maxAttempts}`,
    `- Idempotency key: ${payload.idempotencyKey}`,
    "",
    "## Task prompt",
    payload.prompt,
    "",
    "## Acceptance criteria",
    ...payload.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`),
  ];

  if (payload.priorRejection) {
    lines.push("", "## Prior rejection", payload.priorRejection);
  }
  if (payload.requiredChanges.length > 0) {
    lines.push(
      "",
      "## Required changes",
      ...payload.requiredChanges.map((item, index) => `${index + 1}. ${item}`),
    );
  }

  lines.push(
    "",
    "## Safety rules (mandatory)",
    "- Open a **draft** pull request only when changes are ready.",
    "- Include the exact correlation marker in the PR body.",
    "- Prefer the requested branch prefix; do not push to main/production.",
    "- Do not merge, deploy, or change production secrets.",
    "- Do not call Cloud Agents API endpoints; you are already running as a Cursor Automation.",
    "",
    "Follow this brief exactly.",
  );

  return lines.join("\n");
}

/** Outbound webhook JSON: `context` for Composer + structured `nads` for tooling. */
export function buildAutomationWebhookBody(payload: AutomationDispatchPayload): {
  context: string;
  nads: AutomationDispatchPayload;
} {
  const parsed = AutomationDispatchPayloadSchema.parse(payload);
  return {
    context: buildAutomationComposerContext(parsed),
    nads: parsed,
  };
}
