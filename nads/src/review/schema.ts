import { z } from "zod";

export const ReviewDecisionSchema = z.enum(["ACCEPT", "REJECT", "BLOCKED"]);

export const ReviewFindingSchema = z.object({
  path: z.string().optional(),
  symbol: z.string().optional(),
  problem: z.string(),
  impact: z.string(),
  remediation: z.string(),
  verification: z.string(),
  certainty: z.enum(["confirmed", "likely", "possible", "unverified"]),
});

export const CodeReviewResultSchema = z.object({
  decision: ReviewDecisionSchema,
  summary: z.string(),
  verified_findings: z.array(ReviewFindingSchema),
  failed_acceptance_criteria: z.array(z.string()),
  security_findings: z.array(ReviewFindingSchema),
  regression_findings: z.array(ReviewFindingSchema),
  required_changes: z.array(z.string()),
  required_tests: z.array(z.string()),
  next_task: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.object({
    commit_hashes: z.array(z.string()).default([]),
    test_commands: z.array(z.string()).default([]),
    test_exit_codes: z.array(z.number()).default([]),
    notes: z.string().default(""),
  }),
});

export type CodeReviewResult = z.infer<typeof CodeReviewResultSchema>;

/** JSON Schema fragment for OpenAI structured outputs (mirrors Zod). */
export const OPENAI_REVIEW_JSON_SCHEMA = {
  name: "nads_code_review",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "decision",
      "summary",
      "verified_findings",
      "failed_acceptance_criteria",
      "security_findings",
      "regression_findings",
      "required_changes",
      "required_tests",
      "next_task",
      "confidence",
      "evidence",
    ],
    properties: {
      decision: { type: "string", enum: ["ACCEPT", "REJECT", "BLOCKED"] },
      summary: { type: "string" },
      verified_findings: { type: "array", items: { type: "object", additionalProperties: true } },
      failed_acceptance_criteria: { type: "array", items: { type: "string" } },
      security_findings: { type: "array", items: { type: "object", additionalProperties: true } },
      regression_findings: { type: "array", items: { type: "object", additionalProperties: true } },
      required_changes: { type: "array", items: { type: "string" } },
      required_tests: { type: "array", items: { type: "string" } },
      next_task: { type: ["string", "null"] },
      confidence: { type: "number" },
      evidence: {
        type: "object",
        additionalProperties: false,
        required: ["commit_hashes", "test_commands", "test_exit_codes", "notes"],
        properties: {
          commit_hashes: { type: "array", items: { type: "string" } },
          test_commands: { type: "array", items: { type: "string" } },
          test_exit_codes: { type: "array", items: { type: "number" } },
          notes: { type: "string" },
        },
      },
    },
  },
} as const;
