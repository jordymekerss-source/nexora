# NADS — NEXORA Autonomous Development System

Control plane for the GPT ↔ Cursor autonomous development loop.

**This package is not part of the customer-facing NEXORA SaaS runtime.**  
Do not import `/nads` from `/src` application code. Do not add the OpenAI SDK to the frontend bundle.

## What works now

- Architecture doc with **verified** Cursor Cloud Agents API v1 endpoints
- PostgreSQL control-plane schema (`db/migrations/001_init.sql`)
- Explicit task state machine with illegal-transition guards
- Production `HttpCursorAgentProvider` (create/continue/get/list/stream/cancel/wait)
- Fail-closed `createCursorProviderFromEnv()` when `NADS_MODE=live` without `CURSOR_API_KEY`
- Execution journal (`.nads/execution-journal.json`) for restart recovery / idempotent agent ids
- Mock Cursor provider for dry-run
- Heuristic reviewer (dry-run) + **official OpenAI SDK** structured reviewer (`openai@7`)
- HTTP GitHub adapter (draft PRs; token-gated) — prefer Cursor `autoCreatePR` to avoid duplicate PRs
- Autonomous mock loop: create → REJECT → recovery → ACCEPT (max 3 repairs)
- Unit tests + CLI `dry-run` / `review-smoke` / `cursor-smoke`

## What is not live yet

- Live Cursor smoke **PASS** until `CURSOR_API_KEY` is provisioned (`cursor-smoke` reports **BLOCKED**)
- PostgreSQL + Redis + BullMQ production workers
- Development Control Center UI
- GitHub App merge automation
- Cursor v1 webhooks (docs: coming soon — polling + SSE used instead)

## Setup

```bash
cd nads
npm install
cp .env.example .env   # fill secrets locally only — never commit
npm test
npm run dry-run
npm run typecheck
```

Optional live structured review (one call, no retry):

```bash
npm run review-smoke
```

Live Cursor probe (reports **BLOCKED** if `CURSOR_API_KEY` missing — never silent PASS):

```bash
npm run cursor-smoke
```

## Environment

See `.env.example`. Required for live OpenAI review:

- `OPENAI_API_KEY`
- `NADS_MODE=live`
- `NADS_OPENAI_MODEL` (default `gpt-4o-mini`)

Later / optional:

- `CURSOR_API_KEY`
- `GITHUB_TOKEN`
- `DATABASE_URL` / `REDIS_URL`

Default `NADS_MODE=dry-run` uses mocks and never spends provider budget.

## Security boundaries

Allowed: code tasks on integration branches, tests, docs, draft PRs to integration branch.  
Forbidden: production deploys, production DB, reading production secrets into prompts, unlimited spend, disabling tests to force ACCEPT, shipping OpenAI keys to the browser.
