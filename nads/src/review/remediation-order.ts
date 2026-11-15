/**
 * Deterministic Cursor remediation orders from REJECT review findings.
 * Never invents ACCEPT; respects retry ceilings at the caller.
 */

import type { CodeReviewResult } from "./schema.js";
import type { GitHubReviewEvidence } from "./evidence.js";

export type RemediationItem = {
  path: string | null;
  problem: string;
  requiredFix: string;
  verification: string;
  certainty: string;
};

export type RemediationOrder = {
  schemaVersion: 1;
  taskId: string;
  decision: "REJECT";
  reviewedCommit: string | null;
  repository: string | null;
  prNumber: number | null;
  summary: string;
  items: RemediationItem[];
  acceptanceCriteria: string[];
  requiredTests: string[];
  requiredChanges: string[];
  /** Markdown brief for Cursor Automation / recovery prompt. */
  promptMarkdown: string;
};

function collectFindings(review: CodeReviewResult) {
  return [
    ...review.verified_findings,
    ...review.security_findings,
    ...review.regression_findings,
  ];
}

/** Build a concrete, deterministic remediation order from a REJECT review. */
export function buildRemediationOrder(input: {
  taskId: string;
  review: CodeReviewResult;
  evidence?: GitHubReviewEvidence | null;
  fallbackAcceptanceCriteria?: string[];
}): RemediationOrder {
  if (input.review.decision !== "REJECT") {
    throw new Error(
      `buildRemediationOrder requires decision REJECT (got ${input.review.decision})`,
    );
  }

  const findings = collectFindings(input.review);
  const items: RemediationItem[] =
    findings.length > 0
      ? findings.map((finding) => ({
          path: finding.path,
          problem: finding.problem,
          requiredFix: finding.remediation,
          verification: finding.verification,
          certainty: finding.certainty,
        }))
      : input.review.required_changes.map((change) => ({
          path: null,
          problem: input.review.summary,
          requiredFix: change,
          verification: "Re-run required tests and request re-review",
          certainty: "likely",
        }));

  if (items.length === 0) {
    items.push({
      path: null,
      problem: input.review.summary || "Review rejected without structured findings",
      requiredFix: "Address the rejection summary and re-submit a draft PR",
      verification: "Independent NADS review must pass with verifiable GitHub evidence",
      certainty: "unverified",
    });
  }

  const acceptanceCriteria =
    input.review.failed_acceptance_criteria.length > 0
      ? input.review.failed_acceptance_criteria
      : input.fallbackAcceptanceCriteria ??
        input.evidence?.acceptanceCriteria ??
        [];

  const requiredTests =
    input.review.required_tests.length > 0
      ? input.review.required_tests
      : input.evidence?.checks.map((check) => check.name) ?? [];

  const reviewedCommit =
    input.evidence?.headSha ??
    input.review.evidence.commit_hashes.slice(-1)[0] ??
    null;

  const requiredChanges =
    input.review.required_changes.length > 0
      ? input.review.required_changes
      : items.map((item) =>
          item.path ? `${item.path}: ${item.requiredFix}` : item.requiredFix,
        );

  const promptMarkdown = formatRemediationOrderMarkdown({
    taskId: input.taskId,
    summary: input.review.summary,
    items,
    acceptanceCriteria,
    requiredTests,
    reviewedCommit,
    repository: input.evidence?.repository ?? null,
    prNumber: input.evidence?.prNumber ?? null,
  });

  return {
    schemaVersion: 1,
    taskId: input.taskId,
    decision: "REJECT",
    reviewedCommit,
    repository: input.evidence?.repository ?? null,
    prNumber: input.evidence?.prNumber ?? null,
    summary: input.review.summary,
    items,
    acceptanceCriteria,
    requiredTests,
    requiredChanges,
    promptMarkdown,
  };
}

export function formatRemediationOrderMarkdown(input: {
  taskId: string;
  summary: string;
  items: RemediationItem[];
  acceptanceCriteria: string[];
  requiredTests: string[];
  reviewedCommit: string | null;
  repository: string | null;
  prNumber: number | null;
}): string {
  const lines = [
    "# NADS remediation order",
    "",
    `Task ID: ${input.taskId}`,
    `Reviewed commit: ${input.reviewedCommit ?? "unknown"}`,
    `Repository: ${input.repository ?? "unknown"}`,
    `PR: ${input.prNumber ?? "unknown"}`,
    "",
    "## Rejection summary",
    input.summary,
    "",
    "## Required fixes",
  ];
  for (const [index, item] of input.items.entries()) {
    lines.push(
      `${index + 1}. Path: ${item.path ?? "(unspecified)"}`,
      `   Problem: ${item.problem}`,
      `   Required correction: ${item.requiredFix}`,
      `   Verify: ${item.verification}`,
      `   Certainty: ${item.certainty}`,
    );
  }
  lines.push("", "## Acceptance criteria (must still hold)");
  if (input.acceptanceCriteria.length === 0) {
    lines.push("- (none listed — satisfy original task criteria and review findings)");
  } else {
    for (const [index, item] of input.acceptanceCriteria.entries()) {
      lines.push(`${index + 1}. ${item}`);
    }
  }
  lines.push("", "## Required regression tests");
  if (input.requiredTests.length === 0) {
    lines.push("- Re-run the project's standard unit/typecheck gates and ensure CI checks are green");
  } else {
    for (const [index, item] of input.requiredTests.entries()) {
      lines.push(`${index + 1}. ${item}`);
    }
  }
  lines.push(
    "",
    "## Constraints",
    "- Open a draft PR only; do not merge.",
    "- Include the nads-task correlation marker in the PR body.",
    "- Do not modify production secrets or unrelated systems.",
    `- Base the fix on the reviewed commit ${input.reviewedCommit ?? "(unknown)"} and address every item above.`,
  );
  return lines.join("\n");
}
