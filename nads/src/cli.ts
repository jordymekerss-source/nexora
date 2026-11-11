#!/usr/bin/env node
import { MockCursorAgentProvider } from "./adapters/mock-cursor-adapter.js";
import {
  HeuristicReviewer,
  OpenAIReviewer,
  createReviewerFromEnv,
  resolveOpenAIModel,
} from "./adapters/openai-reviewer.js";
import { createGitHubAdapterFromEnv, UnconfiguredGitHubAdapter } from "./adapters/github-adapter.js";
import { MemoryStore } from "./db/memory-store.js";
import { runTaskLoop } from "./orchestrator/loop.js";

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED]")
      .replace(/github_pat_[a-zA-Z0-9_]+/g, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|authorization/i.test(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactSecrets(nested);
      }
    }
    return out;
  }
  return value;
}

async function dryRun(): Promise<void> {
  const store = new MemoryStore();
  const task = store.seedTask({
    title: "P0: verify signup privilege lock documentation",
    description:
      "Ensure handle_new_user ignores role/tenant metadata and document the regression SQL.",
    priority: 1,
    category: "P0",
    acceptanceCriteria: [
      "Signup cannot grant super_admin via metadata",
      "Regression checklist exists under supabase/tests",
      "No SaaS runtime dependency on /nads",
    ],
  });

  const result = await runTaskLoop({
    store,
    cursor: new MockCursorAgentProvider(),
    reviewer: new HeuristicReviewer(),
    repoUrl: "https://github.com/jordymekerss-source/nexora",
    startingRef: "main",
    taskId: task.id,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.finalStatus === "NEXT_TASK",
        result,
        transitions: store.transitions,
        eventCount: store.events.length,
      },
      null,
      2,
    ),
  );

  if (result.finalStatus !== "NEXT_TASK") {
    process.exitCode = 2;
  }
}

/**
 * Exactly one structured OpenAI review call (official SDK).
 * Requires OPENAI_API_KEY. Does not start Cursor agents. Does not retry.
 */
async function reviewSmoke(): Promise<void> {
  const key = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!key) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "OPENAI_API_KEY missing — review-smoke requires a live key",
      }),
    );
    process.exitCode = 1;
    return;
  }

  const model = resolveOpenAIModel();
  const reviewer = new OpenAIReviewer({ apiKey: key, model });
  const started = Date.now();

  try {
    const review = await reviewer.review({
      taskTitle: "NADS review-smoke",
      acceptanceCriteria: [
        "Reviewer returns a valid structured decision",
        "Evidence fields are present",
      ],
      prompt: "Smoke test only — do not invent repository changes.",
      agentResult:
        "No code changes. This is a connectivity/schema smoke for NADS OpenAIReviewer.",
      testSummary: {
        commands: ["nads:review-smoke"],
        exitCodes: [0],
        notes: "Synthetic evidence for a single live structured-output call.",
      },
      priorRejection: null,
    });

    console.log(
      JSON.stringify(
        redactSecrets({
          ok: true,
          model,
          decision: review.decision,
          confidence: review.confidence,
          summary: review.summary.slice(0, 240),
          required_changes_count: review.required_changes.length,
          elapsedMs: Date.now() - started,
        }),
        null,
        2,
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "review-smoke failed";
    console.log(
      JSON.stringify(
        redactSecrets({
          ok: false,
          model,
          error: message.slice(0, 400),
          elapsedMs: Date.now() - started,
        }),
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

async function githubStatus(): Promise<void> {
  const adapter = createGitHubAdapterFromEnv();
  const configured = !(adapter instanceof UnconfiguredGitHubAdapter);
  if (!configured) {
    console.log(
      JSON.stringify({
        ok: true,
        configured: false,
        message: "GITHUB_TOKEN not set — using UnconfiguredGitHubAdapter",
      }),
    );
    return;
  }

  try {
    const prs = await adapter.listOpenPullRequests();
    console.log(
      JSON.stringify(
        {
          ok: true,
          configured: true,
          openPullRequestCount: prs.length,
          sample: prs.slice(0, 3).map((pr) => ({
            number: pr.number,
            title: pr.title,
            headRef: pr.headRef,
            baseRef: pr.baseRef,
          })),
        },
        null,
        2,
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "github-status failed";
    console.log(
      JSON.stringify(redactSecrets({ ok: false, configured: true, error: message.slice(0, 400) }), null, 2),
    );
    process.exitCode = 1;
  }
}

async function showReviewerMode(): Promise<void> {
  const reviewer = createReviewerFromEnv();
  console.log(
    JSON.stringify({
      mode: (process.env.NADS_MODE ?? "dry-run").toLowerCase(),
      reviewer: reviewer.constructor.name,
      model: resolveOpenAIModel(),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    }),
  );
}

const command = process.argv[2] ?? "dry-run";

const runners: Record<string, () => Promise<void>> = {
  "dry-run": dryRun,
  "review-smoke": reviewSmoke,
  "github-status": githubStatus,
  "reviewer-mode": showReviewerMode,
};

const run = runners[command];
if (!run) {
  console.error(
    `Unknown command: ${command}. Use: dry-run | review-smoke | github-status | reviewer-mode`,
  );
  process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
