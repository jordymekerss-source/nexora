/**
 * Verifiable GitHub review evidence for the independent reviewer.
 * Cursor/agent output is never sufficient for ACCEPT.
 */

export type ReviewFileEvidence = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff when available from GitHub. */
  patch: string | null;
  patchOmittedReason: string | null;
};

export type ReviewCheckEvidence = {
  name: string;
  conclusion: string | null;
};

export type GitHubReviewEvidence = {
  repository: string;
  prNumber: number | null;
  prUrl: string | null;
  headRef: string | null;
  baseRef: string | null;
  headSha: string | null;
  baseSha: string | null;
  commitHashes: string[];
  files: ReviewFileEvidence[];
  checks: ReviewCheckEvidence[];
  acceptanceCriteria: string[];
  /** Explicit notes about truncation / missing patches. */
  limitations: string[];
  /** True when evidence is complete enough for an independent ACCEPT decision. */
  complete: boolean;
  incompleteReasons: string[];
};

export const DEFAULT_MAX_PATCH_CHARS = 60_000;
export const DEFAULT_MAX_FILES = 40;
export const DEFAULT_MAX_PATCH_PER_FILE = 8_000;

export type BuildEvidenceOptions = {
  maxPatchChars?: number;
  maxFiles?: number;
  maxPatchPerFile?: number;
};

/**
 * Build a bounded, auditable evidence package from GitHub PR metadata.
 * Never invents patches or check results.
 */
export function buildGitHubReviewEvidence(input: {
  owner: string;
  repo: string;
  prNumber?: number | null;
  prUrl?: string | null;
  headRef?: string | null;
  baseRef?: string | null;
  headSha?: string | null;
  baseSha?: string | null;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string | null;
  }>;
  checks: Array<{ name: string; conclusion: string | null }>;
  acceptanceCriteria: string[];
  options?: BuildEvidenceOptions;
}): GitHubReviewEvidence {
  const maxPatchChars = input.options?.maxPatchChars ?? DEFAULT_MAX_PATCH_CHARS;
  const maxFiles = input.options?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxPatchPerFile = input.options?.maxPatchPerFile ?? DEFAULT_MAX_PATCH_PER_FILE;
  const limitations: string[] = [];
  const incompleteReasons: string[] = [];

  const repository = `${input.owner}/${input.repo}`;
  const headSha = input.headSha?.trim() || null;
  const baseSha = input.baseSha?.trim() || null;
  const commitHashes = [baseSha, headSha].filter((value): value is string => Boolean(value));

  if (!headSha) incompleteReasons.push("missing_head_sha");
  if (!baseSha) incompleteReasons.push("missing_base_sha");
  if (!input.prNumber) incompleteReasons.push("missing_pr_number");
  if (input.acceptanceCriteria.length === 0) {
    incompleteReasons.push("missing_acceptance_criteria");
  }

  const sliced = input.files.slice(0, maxFiles);
  if (input.files.length > maxFiles) {
    limitations.push(`files_truncated:${input.files.length - maxFiles}_omitted`);
    incompleteReasons.push("too_many_files_for_bounded_review");
  }

  let patchBudget = maxPatchChars;
  const files: ReviewFileEvidence[] = sliced.map((file) => {
    const changed = file.additions > 0 || file.deletions > 0 || file.status !== "unchanged";
    const raw = file.patch ?? null;
    if (!changed) {
      return {
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: null,
        patchOmittedReason: null,
      };
    }
    if (!raw || raw.length === 0) {
      incompleteReasons.push(`missing_patch:${file.filename}`);
      return {
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: null,
        patchOmittedReason: "github_patch_unavailable",
      };
    }
    let patch = raw;
    let omitted: string | null = null;
    if (patch.length > maxPatchPerFile) {
      patch = patch.slice(0, maxPatchPerFile);
      omitted = `truncated_per_file:${maxPatchPerFile}`;
      incompleteReasons.push(`patch_truncated:${file.filename}`);
    }
    if (patch.length > patchBudget) {
      if (patchBudget <= 0) {
        incompleteReasons.push(`patch_budget_exhausted:${file.filename}`);
        return {
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: null,
          patchOmittedReason: "global_patch_budget_exhausted",
        };
      }
      patch = patch.slice(0, patchBudget);
      omitted = omitted ? `${omitted};global_budget` : "truncated_global_budget";
      incompleteReasons.push(`patch_budget_truncated:${file.filename}`);
      patchBudget = 0;
    } else {
      patchBudget -= patch.length;
    }
    return {
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch,
      patchOmittedReason: omitted,
    };
  });

  if (input.files.length === 0) {
    incompleteReasons.push("no_changed_files");
  }

  const checks = input.checks.map((check) => ({
    name: check.name,
    conclusion: check.conclusion,
  }));
  if (checks.length === 0) {
    incompleteReasons.push("missing_ci_checks");
  } else {
    const pending = checks.filter((check) => check.conclusion == null);
    const failed = checks.filter(
      (check) => check.conclusion && check.conclusion !== "success" && check.conclusion !== "skipped",
    );
    if (pending.length > 0) incompleteReasons.push("ci_checks_pending");
    if (failed.length > 0) {
      // Failed checks are valid evidence for REJECT, not incompleteness for review itself.
      limitations.push(`failed_checks:${failed.map((check) => check.name).join(",")}`);
    }
  }

  const uniqueReasons = [...new Set(incompleteReasons)];
  return {
    repository,
    prNumber: input.prNumber ?? null,
    prUrl: input.prUrl ?? null,
    headRef: input.headRef ?? null,
    baseRef: input.baseRef ?? null,
    headSha,
    baseSha,
    commitHashes,
    files,
    checks,
    acceptanceCriteria: [...input.acceptanceCriteria],
    limitations: [...new Set(limitations)],
    complete: uniqueReasons.length === 0,
    incompleteReasons: uniqueReasons,
  };
}

/** Deterministic text block for the reviewer (and audit logs). */
export function formatGitHubEvidenceForReviewer(evidence: GitHubReviewEvidence): string {
  const lines = [
    "# Verifiable GitHub evidence (authoritative)",
    `Repository: ${evidence.repository}`,
    `PR: ${evidence.prNumber ?? "unknown"} ${evidence.prUrl ?? ""}`.trim(),
    `Base: ${evidence.baseRef ?? "unknown"} @ ${evidence.baseSha ?? "unknown"}`,
    `Head: ${evidence.headRef ?? "unknown"} @ ${evidence.headSha ?? "unknown"}`,
    `Commits: ${evidence.commitHashes.join(", ") || "none"}`,
    `Evidence complete: ${evidence.complete ? "yes" : "no"}`,
  ];
  if (evidence.incompleteReasons.length) {
    lines.push(`Incomplete reasons: ${evidence.incompleteReasons.join("; ")}`);
  }
  if (evidence.limitations.length) {
    lines.push(`Limitations: ${evidence.limitations.join("; ")}`);
  }
  lines.push("", "## Acceptance criteria");
  for (const [index, item] of evidence.acceptanceCriteria.entries()) {
    lines.push(`${index + 1}. ${item}`);
  }
  lines.push("", "## CI checks");
  if (evidence.checks.length === 0) {
    lines.push("(none)");
  } else {
    for (const check of evidence.checks) {
      lines.push(`- ${check.name}: ${check.conclusion ?? "pending"}`);
    }
  }
  lines.push("", "## Changed files and patches");
  for (const file of evidence.files) {
    lines.push(
      `### ${file.status} ${file.filename} (+${file.additions}/-${file.deletions})`,
    );
    if (file.patchOmittedReason) {
      lines.push(`Patch omitted: ${file.patchOmittedReason}`);
    }
    if (file.patch) {
      lines.push("```diff", file.patch, "```");
    } else if (!file.patchOmittedReason) {
      lines.push("(no patch)");
    }
  }
  return lines.join("\n");
}

/**
 * Test summary derived only from GitHub check conclusions — never from Cursor claims.
 */
export function testSummaryFromChecks(checks: ReviewCheckEvidence[]): {
  commands: string[];
  exitCodes: number[];
  notes: string;
} {
  const commands = checks.map((check) => check.name);
  const exitCodes = checks.map((check) => {
    if (check.conclusion === "success" || check.conclusion === "skipped") return 0;
    if (check.conclusion == null) return 1;
    return 1;
  });
  const failed = checks.filter(
    (check) => check.conclusion && check.conclusion !== "success" && check.conclusion !== "skipped",
  );
  const pending = checks.filter((check) => check.conclusion == null);
  const notes = [
    "Derived from GitHub check-runs only (Cursor output is untrusted).",
    failed.length ? `Failed: ${failed.map((check) => check.name).join(", ")}` : "No failed checks.",
    pending.length ? `Pending: ${pending.map((check) => check.name).join(", ")}` : "No pending checks.",
  ].join(" ");
  return { commands, exitCodes, notes };
}
