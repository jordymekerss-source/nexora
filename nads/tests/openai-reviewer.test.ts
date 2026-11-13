import { describe, expect, it, vi } from "vitest";
import {
  HeuristicReviewer,
  OpenAIReviewer,
  createReviewerFromEnv,
  resolveOpenAIModel,
} from "../src/adapters/openai-reviewer.js";
import type OpenAI from "openai";

describe("HeuristicReviewer", () => {
  it("rejects planted failure marker", async () => {
    const reviewer = new HeuristicReviewer();
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["a"],
      prompt: "p",
      agentResult: "oops MOCK_IMPLANT_FAIL",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "" },
    });
    expect(result.decision).toBe("REJECT");
    expect(result.verified_findings[0]?.path).toBeNull();
  });

  it("accepts when tests are green and no implant", async () => {
    const reviewer = new HeuristicReviewer();
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["a"],
      prompt: "p",
      agentResult: "clean result",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "ok" },
    });
    expect(result.decision).toBe("ACCEPT");
  });
});

describe("createReviewerFromEnv", () => {
  it("uses heuristic outside live mode even when key present", () => {
    const reviewer = createReviewerFromEnv({
      NADS_MODE: "dry-run",
      OPENAI_API_KEY: "sk-test-not-real",
      NADS_OPENAI_MODEL: "gpt-4o-mini",
    });
    expect(reviewer).toBeInstanceOf(HeuristicReviewer);
  });

  it("uses OpenAIReviewer in live mode with key", () => {
    const reviewer = createReviewerFromEnv({
      NADS_MODE: "live",
      OPENAI_API_KEY: "sk-test-not-real",
      NADS_OPENAI_MODEL: "gpt-4o-mini",
    });
    expect(reviewer).toBeInstanceOf(OpenAIReviewer);
  });

  it("falls back to heuristic in live mode without key", () => {
    const reviewer = createReviewerFromEnv({
      NADS_MODE: "live",
      OPENAI_API_KEY: "",
    });
    expect(reviewer).toBeInstanceOf(HeuristicReviewer);
  });
});

describe("resolveOpenAIModel", () => {
  it("defaults to gpt-4o-mini", () => {
    expect(resolveOpenAIModel({})).toBe("gpt-4o-mini");
  });
});

describe("OpenAIReviewer (mocked SDK client)", () => {
  it("parses structured review without exposing secrets in thrown paths", async () => {
    const parse = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: {
              decision: "REJECT",
              summary: "Evidence incomplete for ACCEPT",
              verified_findings: [],
              failed_acceptance_criteria: ["Need real test logs"],
              security_findings: [],
              regression_findings: [],
              required_changes: ["Attach real CI output"],
              required_tests: ["npm test"],
              next_task: null,
              confidence: 0.8,
              evidence: {
                commit_hashes: [],
                test_commands: ["npm test"],
                test_exit_codes: [0],
                notes: "mocked",
              },
            },
            refusal: null,
            content: null,
          },
        },
      ],
    });

    const client = {
      chat: { completions: { parse } },
    } as unknown as OpenAI;

    const reviewer = new OpenAIReviewer({
      apiKey: "unused-when-client-injected",
      model: "gpt-4o-mini",
      client,
    });

    const result = await reviewer.review({
      taskTitle: "mock",
      acceptanceCriteria: ["Need real test logs"],
      prompt: "p",
      agentResult: "partial",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "mocked" },
    });

    expect(result.decision).toBe("REJECT");
    expect(parse).toHaveBeenCalledTimes(1);
    const callArg = parse.mock.calls[0]?.[0] as { model?: string };
    expect(callArg.model).toBe("gpt-4o-mini");
  });

  it("surfaces refusal without retry", async () => {
    const parse = vi.fn().mockResolvedValue({
      choices: [{ message: { parsed: null, refusal: "policy", content: null } }],
    });
    const client = {
      chat: { completions: { parse } },
    } as unknown as OpenAI;

    const reviewer = new OpenAIReviewer({
      apiKey: "unused",
      model: "gpt-4o-mini",
      client,
    });

    await expect(
      reviewer.review({
        taskTitle: "mock",
        acceptanceCriteria: [],
        prompt: "p",
        agentResult: "x",
        testSummary: { commands: [], exitCodes: [], notes: "" },
      }),
    ).rejects.toThrow(/refused/);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
