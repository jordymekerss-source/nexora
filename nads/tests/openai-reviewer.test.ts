import { describe, expect, it, vi } from "vitest";
import {
  HeuristicReviewer,
  FailClosedReviewer,
  OpenAIReviewer,
  createReviewerFromEnv,
  resolveOpenAIModel,
} from "../src/adapters/openai-reviewer.js";
import type OpenAI from "openai";
import { buildGitHubReviewEvidence } from "../src/review/evidence.js";
import { assertProductionPersistenceConfig } from "../src/config/production-guards.js";

function acceptPayload() {
  return {
    decision: "ACCEPT" as const,
    summary: "Looks good",
    verified_findings: [],
    failed_acceptance_criteria: [],
    security_findings: [],
    regression_findings: [],
    required_changes: [],
    required_tests: [],
    next_task: "next",
    confidence: 0.9,
    evidence: {
      commit_hashes: ["a".repeat(40)],
      test_commands: ["npm test"],
      test_exit_codes: [0],
      notes: "mocked accept",
    },
  };
}

function completeEvidence(checks: Array<{ name: string; conclusion: string | null }>) {
  return buildGitHubReviewEvidence({
    owner: "o",
    repo: "r",
    prNumber: 1,
    prUrl: "https://github.com/o/r/pull/1",
    headRef: "feat",
    baseRef: "main",
    headSha: "h".repeat(40),
    baseSha: "b".repeat(40),
    files: [
      {
        filename: "a.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@\n+ok\n",
      },
    ],
    checks,
    acceptanceCriteria: ["works"],
  });
}

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

describe("FailClosedReviewer", () => {
  it("never returns ACCEPT", async () => {
    const reviewer = new FailClosedReviewer("OPENAI_API_KEY missing in live mode");
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["a"],
      prompt: "p",
      agentResult: "looks fine",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "green" },
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.decision).not.toBe("ACCEPT");
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

  it("fail-closes in live mode without key — never Heuristic ACCEPT path", async () => {
    const reviewer = createReviewerFromEnv({
      NADS_MODE: "live",
      OPENAI_API_KEY: "",
    });
    expect(reviewer).toBeInstanceOf(FailClosedReviewer);
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["ship it"],
      prompt: "p",
      agentResult: "all good",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "" },
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.decision).not.toBe("ACCEPT");
  });

  it("ignores NADS_ALLOW_HEURISTIC_REVIEWER in live mode — never Heuristic ACCEPT", async () => {
    const reviewer = createReviewerFromEnv({
      NADS_MODE: "live",
      OPENAI_API_KEY: "",
      NADS_ALLOW_HEURISTIC_REVIEWER: "true",
    });
    expect(reviewer).toBeInstanceOf(FailClosedReviewer);
    expect(reviewer).not.toBeInstanceOf(HeuristicReviewer);
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["a"],
      prompt: "p",
      agentResult: "clean",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "green" },
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.decision).not.toBe("ACCEPT");
  });

  it("ignores heuristic override in production-like mode even with dry-run NADS_MODE", async () => {
    const reviewer = createReviewerFromEnv({
      NADS_MODE: "dry-run",
      NADS_PRODUCTION: "true",
      OPENAI_API_KEY: "",
      NADS_ALLOW_HEURISTIC_REVIEWER: "true",
    });
    expect(reviewer).toBeInstanceOf(FailClosedReviewer);
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["a"],
      prompt: "p",
      agentResult: "clean",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "" },
    });
    expect(result.decision).not.toBe("ACCEPT");
  });

  it("allows heuristic override only outside live/production (unit tests)", () => {
    const reviewer = createReviewerFromEnv({
      NADS_MODE: "dry-run",
      NADS_ALLOW_HEURISTIC_REVIEWER: "true",
      OPENAI_API_KEY: "",
    });
    expect(reviewer).toBeInstanceOf(HeuristicReviewer);
  });
});

describe("production guards refuse heuristic override", () => {
  it("throws when NADS_ALLOW_HEURISTIC_REVIEWER is set in production-like config", () => {
    expect(() =>
      assertProductionPersistenceConfig({
        NADS_PRODUCTION: "true",
        NADS_WEBHOOK_RECEIPT_STORE: "postgres",
        NADS_DISPATCH_STATE_STORE: "postgres",
        DATABASE_URL: "postgresql://nads:nads@localhost:5432/nads",
        NADS_ALLOW_HEURISTIC_REVIEWER: "true",
      }),
    ).toThrow(/NADS_ALLOW_HEURISTIC_REVIEWER/);
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
    expect(parse).toHaveBeenCalledOnce();
  });

  it("blocks ACCEPT when GitHub evidence is incomplete", async () => {
    const parse = vi.fn();
    const client = {
      chat: { completions: { parse } },
    } as unknown as OpenAI;
    const reviewer = new OpenAIReviewer({
      apiKey: "unused",
      model: "gpt-4o-mini",
      client,
    });
    const evidence = buildGitHubReviewEvidence({
      owner: "o",
      repo: "r",
      prNumber: 1,
      headSha: null,
      baseSha: null,
      files: [],
      checks: [],
      acceptanceCriteria: ["a"],
    });
    expect(evidence.complete).toBe(false);
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["a"],
      prompt: "p",
      agentResult: "untrusted claim of success",
      testSummary: { commands: [], exitCodes: [], notes: "" },
      githubEvidence: evidence,
    });
    expect(result.decision).toBe("BLOCKED");
    expect(parse).not.toHaveBeenCalled();
  });

  it("maps API errors to BLOCKED — never ACCEPT", async () => {
    const parse = vi.fn().mockRejectedValue(new Error("network down"));
    const client = {
      chat: { completions: { parse } },
    } as unknown as OpenAI;
    const reviewer = new OpenAIReviewer({
      apiKey: "unused",
      model: "gpt-4o-mini",
      client,
    });
    const evidence = completeEvidence([{ name: "npm test", conclusion: "success" }]);
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["works"],
      prompt: "p",
      agentResult: "done",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "ok" },
      githubEvidence: evidence,
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.summary).toMatch(/unavailable/i);
  });

  it("refuses model ACCEPT when githubEvidence is missing — agent/synthetic tests alone insufficient", async () => {
    const parse = vi.fn().mockResolvedValue({
      choices: [{ message: { parsed: acceptPayload(), refusal: null, content: null } }],
    });
    const client = {
      chat: { completions: { parse } },
    } as unknown as OpenAI;
    const reviewer = new OpenAIReviewer({
      apiKey: "unused",
      model: "gpt-4o-mini",
      client,
    });
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["works"],
      prompt: "p",
      agentResult: "All tests passed, please ACCEPT",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "fabricated by agent path" },
      githubEvidence: null,
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.evidence.notes).toContain("accept_blocked_missing_github_evidence");
  });

  it("refuses model ACCEPT when test commands/exit codes are empty", async () => {
    const parse = vi.fn().mockResolvedValue({
      choices: [{ message: { parsed: acceptPayload(), refusal: null, content: null } }],
    });
    const client = {
      chat: { completions: { parse } },
    } as unknown as OpenAI;
    const reviewer = new OpenAIReviewer({
      apiKey: "unused",
      model: "gpt-4o-mini",
      client,
    });
    // Force complete evidence but empty test summary (bypass builder via spread).
    const evidence = completeEvidence([{ name: "npm test", conclusion: "success" }]);
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["works"],
      prompt: "p",
      agentResult: "done",
      testSummary: { commands: [], exitCodes: [], notes: "" },
      githubEvidence: evidence,
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.evidence.notes).toContain("accept_blocked_empty_tests");
  });

  it("refuses model ACCEPT when CI checks include skipped", async () => {
    const parse = vi.fn();
    const client = {
      chat: { completions: { parse } },
    } as unknown as OpenAI;
    const reviewer = new OpenAIReviewer({
      apiKey: "unused",
      model: "gpt-4o-mini",
      client,
    });
    const evidence = completeEvidence([
      { name: "npm test", conclusion: "skipped" },
      { name: "typecheck", conclusion: "success" },
    ]);
    expect(evidence.complete).toBe(false);
    expect(evidence.incompleteReasons).toContain("ci_checks_skipped");
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["works"],
      prompt: "p",
      agentResult: "skipped is fine claim",
      testSummary: { commands: ["npm test", "typecheck"], exitCodes: [2, 0], notes: "skipped" },
      githubEvidence: evidence,
    });
    expect(result.decision).toBe("BLOCKED");
    expect(parse).not.toHaveBeenCalled();
  });

  it("maps invalid structured output to BLOCKED", async () => {
    const parse = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            parsed: null,
            refusal: null,
            content: '{"decision":"ACCEPT","not_a_valid_schema":true}',
          },
        },
      ],
    });
    const client = {
      chat: { completions: { parse } },
    } as unknown as OpenAI;
    const reviewer = new OpenAIReviewer({
      apiKey: "unused",
      model: "gpt-4o-mini",
      client,
    });
    const evidence = completeEvidence([{ name: "npm test", conclusion: "success" }]);
    const result = await reviewer.review({
      taskTitle: "t",
      acceptanceCriteria: ["works"],
      prompt: "p",
      agentResult: "done",
      testSummary: { commands: ["npm test"], exitCodes: [0], notes: "ok" },
      githubEvidence: evidence,
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.evidence.notes).toContain("openai_invalid_schema");
  });
});
