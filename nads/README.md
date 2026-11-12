# NADS — NEXORA Autonomous Development System

Control plane for the GPT ↔ Cursor autonomous development loop.

**This package is not part of the customer-facing NEXORA SaaS runtime.**  
Do not import `/nads` from `/src` application code. Do not add the OpenAI SDK to the frontend bundle.

## What works now

- Preferred executor: **`NADS_EXECUTOR=automation`** (webhook dispatch + GitHub completion) — **disabled by default**
- Optional fallback: **`NADS_EXECUTOR=cursor`** → `HttpCursorAgentProvider` (explicit only; never auto-fallback)
- Official OpenAI SDK structured reviewer (`openai@7`) under `/nads` only
- GitHub REST adapter + webhook signature verification / replay protection
- Production-oriented HTTP ingress (`ingress-serve`, disabled by default)
- Persistent webhook receipts + cross-event completion dedupe
- Automation payload→`context` prompt bridge (see `docs/AUTOMATION_PAYLOAD_CONTRACT.md`)
- Execution journal, state machine, mock dry-run loop (REJECT → ACCEPT)
- CLI: `dry-run`, `executor-status`, `automation-dispatch-dry`, `ingress-serve`, `review-smoke`

## What is not live yet

- Automation webhook send (`NADS_AUTOMATION_ENABLED=false` until account eligibility verified)
- Hosted TLS termination + public GitHub → NADS ingress deployment
- PostgreSQL + Redis + BullMQ production workers (SQL migrations ready through `003`)
- Development Control Center UI

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

Preferred prep checks (no prepaid API):

```bash
npm run executor-status
npm run automation-dispatch-dry
```

Optional Cursor API smoke (calls `POST /v1/agents`) — disabled unless `NADS_ALLOW_CURSOR_API_SMOKE=true`.

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
