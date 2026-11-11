import {
  CodeReviewResultSchema,
  OPENAI_REVIEW_JSON_SCHEMA,
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

/** Live OpenAI structured review — only used when OPENAI_API_KEY is set. */
export class OpenAIReviewer implements Reviewer {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async review(input: ReviewInput): Promise<CodeReviewResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are an independent code reviewer for NEXORA. Never mark ACCEPT without evidence of passing tests. Do not invent test results.",
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: OPENAI_REVIEW_JSON_SCHEMA,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI review failed: ${response.status} ${text.slice(0, 400)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI review returned empty content");
    }
    return CodeReviewResultSchema.parse(JSON.parse(content));
  }
}
