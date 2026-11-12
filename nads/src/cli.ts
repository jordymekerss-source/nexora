#!/usr/bin/env node
import { MockCursorAgentProvider } from "./adapters/mock-cursor-adapter.js";
import {
  HeuristicReviewer,
  OpenAIReviewer,
  createReviewerFromEnv,
  resolveOpenAIModel,
} from "./adapters/openai-reviewer.js";
import { createGitHubAdapterFromEnv, UnconfiguredGitHubAdapter } from "./adapters/github-adapter.js";
import { createCursorProviderFromEnv } from "./adapters/cursor-factory.js";
import { createExecutorFromEnv } from "./adapters/executor.js";
import { HttpCursorAgentProvider } from "./adapters/cursor-http-adapter.js";
import { MemoryStore } from "./db/memory-store.js";
import { ExecutionJournal } from "./db/execution-journal.js";
import { runTaskLoop } from "./orchestrator/loop.js";
import { dispatchAutomationTask } from "./orchestrator/automation-lifecycle.js";
import { AutomationExecutor } from "./adapters/automation-executor.js";
import { createWebhookReceiptStoreFromEnv } from "./db/webhook-receipts.js";
import { createNadsIngressServer, listenNadsIngress } from "./ingress/http-server.js";

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED]")
      .replace(/github_pat_[a-zA-Z0-9_]+/g, "[REDACTED]")
      .replace(/key_[a-zA-Z0-9_-]{10,}/g, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/^(?:.*(?:token|secret|password|authorization).*|apiKey|webhookKey)$/i.test(key)) {
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
      JSON.stringify(
        redactSecrets({ ok: false, configured: true, error: message.slice(0, 400) }),
        null,
        2,
      ),
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

async function showProviderMode(): Promise<void> {
  const mode = (process.env.NADS_MODE ?? "dry-run").toLowerCase();
  const hasCursorKey = Boolean(process.env.CURSOR_API_KEY?.trim());
  let providerName = "unresolved";
  let error: string | null = null;
  try {
    const provider = createCursorProviderFromEnv();
    providerName = provider.constructor.name;
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : "provider resolve failed";
  }
  console.log(
    JSON.stringify({
      mode,
      provider: providerName,
      hasCursorKey,
      note: "Deprecated entry — prefer executor-status / NADS_EXECUTOR",
      error,
    }),
  );
  if (error) process.exitCode = 2;
}

async function showExecutorStatus(): Promise<void> {
  const automation = AutomationExecutor.fromEnv();
  let executorKind = "unresolved";
  let error: string | null = null;
  try {
    const executor = createExecutorFromEnv();
    executorKind = executor.kind;
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : "executor resolve failed";
  }
  console.log(
    JSON.stringify({
      NADS_EXECUTOR: process.env.NADS_EXECUTOR ?? "mock",
      resolvedExecutor: executorKind,
      automationEnabled: automation.isEnabled(),
      automationCredentialsPresent: automation.hasCredentials(),
      preferred: "automation",
      automaticCursorFallback: false,
      error,
    }),
  );
  if (error) process.exitCode = 2;
}

/**
 * Validate automation dispatch path without sending (NADS_AUTOMATION_ENABLED must stay false).
 * Never calls POST /v1/agents.
 */
async function automationDispatchDry(): Promise<void> {
  if ((process.env.NADS_AUTOMATION_ENABLED ?? "false").toLowerCase() === "true") {
    console.log(
      JSON.stringify({
        ok: false,
        error:
          "Refusing automation-dispatch-dry while NADS_AUTOMATION_ENABLED=true — disable the flag for prep dry validation",
      }),
    );
    process.exitCode = 2;
    return;
  }

  const store = new MemoryStore();
  const task = store.seedTask({
    title: "Automation dry dispatch",
    description: "Prep-only validation of automation executor",
    acceptanceCriteria: ["No network send", "No /v1/agents"],
  });
  const executor = createExecutorFromEnv({
    ...process.env,
    NADS_EXECUTOR: process.env.NADS_EXECUTOR ?? "automation",
    NADS_AUTOMATION_ENABLED: "false",
  });

  const outcome = await dispatchAutomationTask({
    store,
    executor,
    taskId: task.id,
    repoUrl: process.env.NADS_REPO_URL ?? "https://github.com/jordymekerss-source/nexora",
  });

  console.log(
    JSON.stringify(
      redactSecrets({
        ok: outcome.status === "disabled" || outcome.status === "idempotent_replay",
        outcome,
        taskStatus: store.tasks.find((row) => row.id === task.id)?.status,
        note: "Payload validated; network send disabled. No Cloud Agents API call.",
      }),
      null,
      2,
    ),
  );
}

/**
 * OPTIONAL fallback probe only. Refuses unless NADS_ALLOW_CURSOR_API_SMOKE=true.
 * Preferred architecture does not use this path.
 */
async function cursorSmoke(): Promise<void> {
  if ((process.env.NADS_ALLOW_CURSOR_API_SMOKE ?? "").toLowerCase() !== "true") {
    console.log(
      JSON.stringify({
        ok: false,
        status: "BLOCKED",
        reason:
          "cursor-smoke is an optional fallback probe and is disabled by default. Preferred executor is automation. Set NADS_ALLOW_CURSOR_API_SMOKE=true only for explicit prepaid/API testing.",
        callsPostV1Agents: true,
      }),
    );
    process.exitCode = 0;
    return;
  }

  const key = process.env.CURSOR_API_KEY?.trim() ?? "";
  if (!key) {
    console.log(
      JSON.stringify({
        ok: false,
        status: "BLOCKED",
        reason: "CURSOR_API_KEY not configured — live Cursor integration not executed",
        endpointsDocumented: [
          "POST /v1/agents",
          "GET /v1/agents/{id}",
          "POST /v1/agents/{id}/runs",
          "GET /v1/agents/{id}/runs",
          "GET /v1/agents/{id}/runs/{runId}",
          "GET /v1/agents/{id}/runs/{runId}/stream",
          "POST /v1/agents/{id}/runs/{runId}/cancel",
        ],
      }),
    );
    process.exitCode = 0;
    return;
  }

  const repoUrl =
    process.env.NADS_REPO_URL?.trim() || "https://github.com/jordymekerss-source/nexora";
  const startingRef = process.env.NADS_CURSOR_STARTING_REF?.trim() || "main";
  const autoCreatePR = process.env.NADS_CURSOR_AUTO_CREATE_PR === "true";
  const started = Date.now();
  const journal = new ExecutionJournal(ExecutionJournal.defaultPath());
  await journal.load();

  const provider = new HttpCursorAgentProvider({
    apiKey: key,
    baseUrl: process.env.CURSOR_API_BASE_URL?.trim() || "https://api.cursor.com/v1",
    defaultPollIntervalMs: Number(process.env.NADS_POLL_INTERVAL_MS ?? 5_000),
    defaultTimeoutMs: Number(process.env.NADS_RUN_TIMEOUT_MS ?? 20 * 60_000),
  });

  const store = new MemoryStore();
  const task = store.seedTask({
    title: "NADS cursor-smoke probe",
    description:
      "Harmless probe for NADS live Cursor integration. Create nads/docs/CURSOR_SMOKE_PROBE.md " +
      "with exactly one line: NADS cursor smoke probe. Do not modify any other files. " +
      "Do not touch main or production. Push only to the Cursor-generated cursor/* branch.",
    acceptanceCriteria: [
      "Only nads/docs/CURSOR_SMOKE_PROBE.md is added/updated",
      "No changes to main",
      "Work lands on a Cursor-generated branch",
    ],
    maxRetries: 0,
  });

  try {
    const created = await provider.createAgent({
      prompt: {
        text: [
          "You are running a NADS connectivity probe.",
          "Create file nads/docs/CURSOR_SMOKE_PROBE.md containing exactly:",
          "NADS cursor smoke probe",
          "Do not modify any other files.",
          "Do not merge or push to main.",
          "Stop after the file exists on the agent branch.",
        ].join("\n"),
      },
      repos: [{ url: repoUrl, startingRef }],
      name: "nads-cursor-smoke",
      autoCreatePR,
      workOnCurrentBranch: false,
      agentId: `bc-${task.id}`,
    });

    await journal.upsert({
      taskId: task.id,
      agentId: created.agent.id,
      runId: created.run.id,
      iteration: 1,
      status: created.run.status,
      updatedAt: new Date().toISOString(),
    });

    const terminal = await provider.waitForRun(created.agent.id, created.run.id);
    const branch = terminal.git?.branches?.[0];

    store.recordAgentSession({
      taskId: task.id,
      providerAgentId: created.agent.id,
      providerRunId: terminal.id,
      branchName: branch?.branch,
      status: terminal.status,
    });

    store.appendEvent({
      taskId: task.id,
      eventType: "cursor.smoke.completed",
      payload: {
        agentId: created.agent.id,
        runId: terminal.id,
        status: terminal.status,
        branch: branch?.branch ?? null,
        prUrl: branch?.prUrl ?? null,
        agentUrl: created.agent.url ?? null,
      },
      idempotencyKey: `cursor-smoke:${created.agent.id}:${terminal.id}`,
    });

    await journal.upsert({
      taskId: task.id,
      agentId: created.agent.id,
      runId: terminal.id,
      iteration: 1,
      status: terminal.status,
      branchName: branch?.branch,
      prUrl: branch?.prUrl,
      updatedAt: new Date().toISOString(),
    });

    const pass = terminal.status === "FINISHED" && Boolean(branch?.branch);
    console.log(
      JSON.stringify(
        redactSecrets({
          ok: pass,
          status: pass ? "PASS" : "FAIL",
          agentId: created.agent.id,
          runId: terminal.id,
          runStatus: terminal.status,
          branch: branch?.branch ?? null,
          prUrl: branch?.prUrl ?? null,
          agentUrl: created.agent.url ?? null,
          resultPreview: (terminal.result ?? "").slice(0, 240),
          durationMs: terminal.durationMs ?? null,
          elapsedMs: Date.now() - started,
          evidenceEvents: store.events.length,
          autoCreatePR,
          note: autoCreatePR
            ? "PR creation delegated to Cursor autoCreatePR (NADS GitHub adapter not used to avoid duplicates)"
            : "autoCreatePR=false — verify branch only; enable NADS_CURSOR_AUTO_CREATE_PR=true to let Cursor open a draft PR",
        }),
        null,
        2,
      ),
    );
    process.exitCode = pass ? 0 : 1;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "cursor-smoke failed";
    const billingBlocked =
      /usage_limit_exceeded|prepaid balance|add funds|auto top-up|billing/i.test(message);
    const authBlocked = /→ 401|→ 403|unauthorized|forbidden/i.test(message);
    const status = billingBlocked || authBlocked ? "BLOCKED" : "FAIL";
    console.log(
      JSON.stringify(
        redactSecrets({
          ok: false,
          status,
          error: message.slice(0, 500),
          elapsedMs: Date.now() - started,
          note: billingBlocked
            ? "Cursor API authenticated, but prepaid balance is exhausted — top up Cursor billing, then re-run npm run cursor-smoke (no automatic retry)."
            : authBlocked
              ? "Cursor API rejected credentials or permissions."
              : undefined,
        }),
        null,
        2,
      ),
    );
    // BLOCKED = environment/billing, not an implementation defect.
    process.exitCode = status === "FAIL" ? 1 : 0;
  }
}

/**
 * Receive-only ingress. Does not enable Automation send.
 * Refuses unless NADS_INGRESS_ENABLED=true.
 */
async function ingressServe(): Promise<void> {
  if ((process.env.NADS_INGRESS_ENABLED ?? "false").toLowerCase() !== "true") {
    console.log(
      JSON.stringify({
        ok: false,
        status: "BLOCKED",
        reason:
          "ingress-serve is disabled by default. Set NADS_INGRESS_ENABLED=true only when intentionally hosting receive endpoints. Does not send Automation webhooks or call /v1/agents.",
      }),
    );
    process.exitCode = 0;
    return;
  }

  const githubSecret = process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? "";
  if (!githubSecret) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "GITHUB_WEBHOOK_SECRET required when NADS_INGRESS_ENABLED=true",
      }),
    );
    process.exitCode = 2;
    return;
  }

  const store = new MemoryStore();
  const github = createGitHubAdapterFromEnv();
  const reviewer = createReviewerFromEnv();
  const receipts = createWebhookReceiptStoreFromEnv();
  const server = createNadsIngressServer({
    store,
    github,
    reviewer,
    receipts,
    githubWebhookSecret: githubSecret,
    automationCallbackSecret: process.env.NADS_AUTOMATION_CALLBACK_SECRET,
    maxBodyBytes: Number(process.env.NADS_INGRESS_MAX_BODY_BYTES ?? 1_048_576),
    readyCheck: () => true,
  });

  const host = process.env.NADS_INGRESS_HOST ?? "127.0.0.1";
  const port = Number(process.env.NADS_INGRESS_PORT ?? 8787);
  const bound = await listenNadsIngress(server, { host, port });
  console.log(
    JSON.stringify({
      ok: true,
      listening: `http://${bound.host}:${bound.port}`,
      routes: ["/health", "/ready", "/webhooks/github", "/webhooks/automation-callback"],
      automationSendEnabled: false,
      note: "Receive-only ingress. NADS_AUTOMATION_ENABLED remains independent and defaults false.",
    }),
  );
}

const command = process.argv[2] ?? "dry-run";

const runners: Record<string, () => Promise<void>> = {
  "dry-run": dryRun,
  "review-smoke": reviewSmoke,
  "github-status": githubStatus,
  "reviewer-mode": showReviewerMode,
  "provider-mode": showProviderMode,
  "executor-status": showExecutorStatus,
  "automation-dispatch-dry": automationDispatchDry,
  "ingress-serve": ingressServe,
  "cursor-smoke": cursorSmoke,
};

const run = runners[command];
if (!run) {
  console.error(
    `Unknown command: ${command}. Use: dry-run | review-smoke | github-status | reviewer-mode | provider-mode | executor-status | automation-dispatch-dry | ingress-serve | cursor-smoke`,
  );
  process.exit(1);
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
