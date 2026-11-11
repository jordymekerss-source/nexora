import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  CodeReviewResultSchema,
  type CodeReviewResult,
} from "../review/schema.js";

export type ReviewInput = {
  taskTitle: string;
  acceptanceCriteria: string[];
  prompt: string;
  agentResult: string;
  testSummary: {
    commands: string[];
    exitCodes: number[];
    notes: string;
  };
  priorRejection?: string | null;
};

export interface Reviewer {
  review(input: ReviewInput): Promise<CodeReviewResult>;
}

/**
 * Deterministic local reviewer for dry-run / CI without OpenAI keys.
 * Rejects when agent result contains MOCK_IMPLANT_FAIL; otherwise accepts if tests green.
 */
export class HeuristicReviewer implements Reviewer {
  async review(input: ReviewInput): Promise<CodeReviewResult> {
    const plantedFail = input.agentResult.includes("MOCK_IMPLANT_FAIL");
    const testsFailed = input.testSummary.exitCodes.some((code) => code !== 0);

    if (plantedFail || testsFailed) {
      return CodeReviewResultSchema.parse({
        decision: "REJECT",
        summary: plantedFail
          ? "Planted failure marker present in agent output."
          : "One or more required tests failed.",
        verified_findings: [
          {
            path: null,
            symbol: null,
            problem: plantedFail ? "MOCK_IMPLANT_FAIL marker in result" : "Non-zero test exit code",
            impact: "Task acceptance criteria not met",
            remediation: "Fix implementation and re-run required tests",
            verification: "Re-run unit/e2e gates and confirm exit code 0",
            certainty: "confirmed",
          },
        ],
        failed_acceptance_criteria: input.acceptanceCriteria.slice(0, 3),
        security_findings: [],
        regression_findings: [],
        required_changes: [
          plantedFail
            ? "Remove planted failure and implement the requested change correctly"
            : "Fix failing tests before re-review",
        ],
        required_tests: input.testSummary.commands,
        next_task: null,
        confidence: 0.9,
        evidence: {
          commit_hashes: [],
          test_commands: input.testSummary.commands,
          test_exit_codes: input.testSummary.exitCodes,
          notes: input.testSummary.notes,
        },
      });
    }

    return CodeReviewResultSchema.parse({
      decision: "ACCEPT",
      summary: "No planted failures; recorded test exit codes are zero.",
      verified_findings: [],
      failed_acceptance_criteria: [],
      security_findings: [],
      regression_findings: [],
      required_changes: [],
      required_tests: [],
      next_task: "Select next prioritized roadmap task",
      confidence: 0.75,
      evidence: {
        commit_hashes: [],
        test_commands: input.testSummary.commands,
        test_exit_codes: input.testSummary.exitCodes,
        notes: input.testSummary.notes,
      },
    });
  }
}

export type OpenAIReviewerOptions = {
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Injected client for unit tests — never log secrets. */
  client?: OpenAI;
};

/**
 * Live OpenAI structured review via the official Node SDK.
 * Server-side / control-plane only — never import into the Next.js browser bundle.
 *
 * Uses Chat Completions + Structured Outputs (json_schema / zodResponseFormat).
 * Docs: https://developers.openai.com/api/docs/guides/structured-outputs
 * SDK: https://github.com/openai/openai-node
 */
export class OpenAIReviewer implements Reviewer {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIReviewerOptions) {
    if (!options.apiKey && !options.client) {
      throw new Error("OPENAI_API_KEY is required for OpenAIReviewer");
    }
    this.model = options.model;
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
      });
  }

  async review(input: ReviewInput): Promise<CodeReviewResult> {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You are an independent code reviewer for NEXORA / NADS. " +
            "Never mark ACCEPT without evidence of passing tests. " +
            "Do not invent test results. Prefer REJECT or BLOCKED when evidence is incomplete. " +
            "Never request or echo API keys or secrets.",
        },
        {
          role: "user",
          content: JSON.stringify(input),
        },
      ],
      response_format: zodResponseFormat(CodeReviewResultSchema, "nads_code_review"),
      temperature: 0,
    });

    const refusal = completion.choices[0]?.message?.refusal;
    if (refusal) {
      throw new Error(`OpenAI review refused: ${refusal.slice(0, 400)}`);
    }

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) {
      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new Error("OpenAI review returned empty content");
      }
      return CodeReviewResultSchema.parse(JSON.parse(raw));
    }

    return CodeReviewResultSchema.parse(parsed);
  }
}

/** Default model verified against this account; override via NADS_OPENAI_MODEL. */
export const DEFAULT_NADS_OPENAI_MODEL = "gpt-4o-mini";

export function resolveOpenAIModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.NADS_OPENAI_MODEL?.trim() || DEFAULT_NADS_OPENAI_MODEL;
}

/**
 * Select reviewer for the control plane.
 * - dry-run / missing key → HeuristicReviewer (no spend)
 * - live + OPENAI_API_KEY → OpenAIReviewer (official SDK)
 */
export function createReviewerFromEnv(env: NodeJS.ProcessEnv = process.env): Reviewer {
  const mode = (env.NADS_MODE ?? "dry-run").toLowerCase();
  const key = env.OPENAI_API_KEY?.trim() ?? "";

  if (mode !== "live" || !key) {
    return new HeuristicReviewer();
  }

  return new OpenAIReviewer({
    apiKey: key,
    model: resolveOpenAIModel(env),
    baseURL: env.OPENAI_API_BASE_URL?.trim() || undefined,
  });
}
