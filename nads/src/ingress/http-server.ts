import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { GitHubAdapter } from "../adapters/github-adapter.js";
import type { Reviewer } from "../adapters/openai-reviewer.js";
import type { MemoryStore } from "../db/memory-store.js";
import type { ExecutionJournal } from "../db/execution-journal.js";
import type { WebhookReceiptStore } from "../db/webhook-receipts.js";
import type { DispatchStateStore } from "../db/dispatch-state.js";
import {
  completeAutomationTaskFromCallback,
  completeAutomationTaskFromGitHub,
} from "../orchestrator/automation-lifecycle.js";
import { verifyAutomationCallback, AutomationCallbackError } from "./automation-callback.js";
import { verifyGitHubWebhookSignature, GitHubWebhookError } from "./github-webhook.js";

export type NadsIngressOptions = {
  store: MemoryStore;
  github: GitHubAdapter;
  reviewer: Reviewer;
  receipts: WebhookReceiptStore;
  journal?: ExecutionJournal;
  dispatchState?: DispatchStateStore;
  githubWebhookSecret: string;
  automationCallbackSecret?: string;
  maxBodyBytes?: number;
  readyCheck?: () => boolean | Promise<boolean>;
  /**
   * Simple in-process rate limit (requests per window).
   * Production should also enforce limits at the reverse proxy.
   */
  rateLimitPerWindow?: number;
  rateLimitWindowMs?: number;
};

const SAFE_JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SAFE_JSON_HEADERS,
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readRawBody(
  req: IncomingMessage,
  maxBodyBytes: number,
): Promise<{ ok: true; body: Buffer } | { ok: false; status: number; error: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (status: number, error: string) => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolve({ ok: false, status, error });
    };
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        fail(413, "payload_too_large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: true, body: Buffer.concat(chunks) });
    });
    req.on("error", () => fail(400, "body_read_error"));
  });
}

function headerMap(req: IncomingMessage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

function requireJsonContentType(req: IncomingMessage): boolean {
  const raw = req.headers["content-type"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return false;
  return value.toLowerCase().includes("application/json");
}

class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const prior = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (prior.length >= this.limit) {
      this.hits.set(key, prior);
      return false;
    }
    prior.push(now);
    this.hits.set(key, prior);
    return true;
  }
}

/**
 * Production-oriented NADS ingress (HTTP).
 * Terminate TLS at the reverse proxy / platform edge; this server expects raw bodies.
 * Does not dispatch Automations or call /v1/agents.
 */
export function createNadsIngressServer(options: NadsIngressOptions): Server {
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
  const rateLimiter =
    options.rateLimitPerWindow && options.rateLimitPerWindow > 0
      ? new SlidingWindowRateLimiter(
          options.rateLimitPerWindow,
          options.rateLimitWindowMs ?? 60_000,
        )
      : null;

  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, service: "nads-ingress", automationSend: false });
        return;
      }

      if (method === "GET" && url.pathname === "/ready") {
        const ready = options.readyCheck ? await options.readyCheck() : true;
        sendJson(res, ready ? 200 : 503, { ok: ready, service: "nads-ingress" });
        return;
      }

      if (method === "POST" && (url.pathname === "/webhooks/github" || url.pathname === "/webhooks/automation-callback")) {
        if (rateLimiter) {
          const ip = req.socket.remoteAddress ?? "unknown";
          if (!rateLimiter.allow(`${url.pathname}:${ip}`)) {
            sendJson(res, 429, { ok: false, error: "rate_limited" });
            return;
          }
        }
        if (!requireJsonContentType(req)) {
          sendJson(res, 415, { ok: false, error: "unsupported_media_type" });
          return;
        }
      }

      if (method === "POST" && url.pathname === "/webhooks/github") {
        const raw = await readRawBody(req, maxBodyBytes);
        if (!raw.ok) {
          sendJson(res, raw.status, { ok: false, error: raw.error });
          return;
        }
        try {
          const verified = verifyGitHubWebhookSignature(raw.body, headerMap(req), {
            secret: options.githubWebhookSecret,
          });
          const outcome = await completeAutomationTaskFromGitHub({
            store: options.store,
            reviewer: options.reviewer,
            github: options.github,
            verified,
            journal: options.journal,
            receipts: options.receipts,
            rawBody: raw.body,
          });
          sendJson(res, 200, {
            ok: true,
            handled: outcome.handled,
            reason: outcome.reason,
            taskId: outcome.taskId,
            decision: outcome.decision ?? null,
          });
        } catch (error: unknown) {
          if (error instanceof GitHubWebhookError) {
            const status =
              error.code === "replay" || error.code === "replay_skew"
                ? 409
                : error.code === "invalid_signature" || error.code === "missing_secret"
                  ? 401
                  : 400;
            sendJson(res, status, { ok: false, error: error.code });
            return;
          }
          sendJson(res, 500, { ok: false, error: "internal_error" });
        }
        return;
      }

      if (method === "POST" && url.pathname === "/webhooks/automation-callback") {
        const secret = options.automationCallbackSecret?.trim() ?? "";
        if (!secret) {
          sendJson(res, 503, { ok: false, error: "callback_disabled" });
          return;
        }
        const raw = await readRawBody(req, maxBodyBytes);
        if (!raw.ok) {
          sendJson(res, raw.status, { ok: false, error: raw.error });
          return;
        }
        try {
          const callback = verifyAutomationCallback(raw.body.toString("utf8"), headerMap(req), {
            secret,
          });
          const outcome = await completeAutomationTaskFromCallback({
            store: options.store,
            reviewer: options.reviewer,
            github: options.github,
            callback,
            journal: options.journal,
            receipts: options.receipts,
            rawBody: raw.body,
          });
          sendJson(res, 200, {
            ok: true,
            handled: outcome.handled,
            reason: outcome.reason,
            taskId: outcome.taskId,
            decision: outcome.decision ?? null,
          });
        } catch (error: unknown) {
          if (error instanceof AutomationCallbackError) {
            const status =
              error.code === "replay" || error.code === "replay_skew"
                ? 409
                : error.code === "invalid_signature" || error.code === "missing_secret"
                  ? 401
                  : 400;
            sendJson(res, status, { ok: false, error: error.code });
            return;
          }
          sendJson(res, 500, { ok: false, error: "internal_error" });
        }
        return;
      }

      sendJson(res, 404, { ok: false, error: "not_found" });
    } catch {
      sendJson(res, 500, { ok: false, error: "internal_error" });
    }
  });
}

export async function listenNadsIngress(
  server: Server,
  options: { host?: string; port?: number },
): Promise<{ host: string; port: number }> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  return { host, port };
}
