import { describe, expect, it } from "vitest";
import {
  buildGitHubReviewEvidence,
  classifyCheckConclusion,
  checksAllSucceeded,
  testSummaryFromChecks,
} from "../src/review/evidence.js";

function baseInput(
  checks: Array<{ name: string; conclusion: string | null }>,
) {
  return {
    owner: "o",
    repo: "r",
    prNumber: 1,
    headSha: "h".repeat(40),
    baseSha: "b".repeat(40),
    files: [
      {
        filename: "a.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@\n+x\n",
      },
    ],
    checks,
    acceptanceCriteria: ["a"],
  };
}

describe("classifyCheckConclusion", () => {
  it("distinguishes success, skipped, pending, failure", () => {
    expect(classifyCheckConclusion("success")).toBe("success");
    expect(classifyCheckConclusion("skipped")).toBe("skipped");
    expect(classifyCheckConclusion("neutral")).toBe("skipped");
    expect(classifyCheckConclusion(null)).toBe("pending");
    expect(classifyCheckConclusion("")).toBe("pending");
    expect(classifyCheckConclusion("failure")).toBe("failure");
    expect(classifyCheckConclusion("cancelled")).toBe("failure");
    expect(classifyCheckConclusion("weird")).toBe("failure");
  });
});

describe("testSummaryFromChecks — skipped is not success", () => {
  it("maps each outcome to distinct non-success exit codes except success=0", () => {
    const summary = testSummaryFromChecks([
      { name: "unit", conclusion: "success" },
      { name: "e2e", conclusion: "skipped" },
      { name: "lint", conclusion: null },
      { name: "build", conclusion: "failure" },
    ]);
    expect(summary.outcomes.map((row) => row.kind)).toEqual([
      "success",
      "skipped",
      "pending",
      "failure",
    ]);
    expect(summary.exitCodes).toEqual([0, 2, 3, 1]);
    expect(summary.notes).toContain("skipped=e2e");
    expect(summary.notes).toContain("pending=lint");
    expect(summary.notes).toContain("failure=build");
  });

  it("empty checks are missing — not success", () => {
    const summary = testSummaryFromChecks([]);
    expect(summary.commands).toEqual([]);
    expect(summary.exitCodes).toEqual([]);
    expect(summary.notes).toContain("missing=all_checks_absent");
    expect(checksAllSucceeded([])).toBe(false);
  });
});

describe("buildGitHubReviewEvidence CI completeness", () => {
  it("marks skipped checks incomplete (not ACCEPT-ready)", () => {
    const evidence = buildGitHubReviewEvidence(
      baseInput([
        { name: "npm test", conclusion: "skipped" },
        { name: "typecheck", conclusion: "success" },
      ]),
    );
    expect(evidence.complete).toBe(false);
    expect(evidence.incompleteReasons).toEqual(
      expect.arrayContaining(["ci_checks_skipped"]),
    );
  });

  it("marks pending checks incomplete", () => {
    const evidence = buildGitHubReviewEvidence(
      baseInput([{ name: "npm test", conclusion: null }]),
    );
    expect(evidence.complete).toBe(false);
    expect(evidence.incompleteReasons).toEqual(
      expect.arrayContaining(["ci_checks_pending", "ci_checks_no_success"]),
    );
  });

  it("marks missing checks incomplete", () => {
    const evidence = buildGitHubReviewEvidence(baseInput([]));
    expect(evidence.complete).toBe(false);
    expect(evidence.incompleteReasons).toContain("missing_ci_checks");
  });

  it("failed checks remain reviewable evidence but are not all-success", () => {
    const evidence = buildGitHubReviewEvidence(
      baseInput([
        { name: "npm test", conclusion: "failure" },
        { name: "typecheck", conclusion: "success" },
      ]),
    );
    // Still incomplete because not all succeeded? We only require ≥1 success and no pending/skipped.
    // Failed checks do not add incompleteness — reviewer can REJECT.
    expect(evidence.incompleteReasons).not.toContain("ci_checks_pending");
    expect(evidence.incompleteReasons).not.toContain("ci_checks_skipped");
    expect(evidence.complete).toBe(true);
    expect(checksAllSucceeded(evidence.checks)).toBe(false);
    expect(evidence.limitations.some((row) => row.startsWith("failed_checks:"))).toBe(true);
  });

  it("all-success checks can be complete", () => {
    const evidence = buildGitHubReviewEvidence(
      baseInput([
        { name: "npm test", conclusion: "success" },
        { name: "typecheck", conclusion: "success" },
      ]),
    );
    expect(evidence.complete).toBe(true);
    expect(checksAllSucceeded(evidence.checks)).toBe(true);
  });
});
