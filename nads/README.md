# NADS — NEXORA Autonomous Development System

Control plane for the GPT ↔ Cursor autonomous development loop.

**This package is not part of the customer-facing NEXORA SaaS runtime.**  
Do not import `/nads` from `/src` application code.

## What works now (Phases 1–2)

- Architecture doc with **verified** Cursor Cloud Agents API v1 endpoints
- PostgreSQL control-plane schema (`db/migrations/001_init.sql`)
- Explicit task state machine with illegal-transition guards
- `CursorAgentProvider` + HTTP adapter (`POST/GET /v1/agents…`)
- Mock Cursor provider for dry-run
- Heuristic reviewer (dry-run) + OpenAI structured reviewer (when keyed)
- Autonomous loop: create → REJECT planted fail → recovery → ACCEPT
- Idempotent event store
- Emergency stop / autonomous flags
- Unit tests + CLI dry-run

## What is not live yet

- Real Cursor/OpenAI calls without API keys
- PostgreSQL + Redis + BullMQ production workers
- Development Control Center UI
- GitHub App merge automation
- Cursor v1 webhooks (docs: coming soon — polling used instead)

## Setup

```bash
cd nads
npm install
cp .env.example .env   # fill secrets locally only
npm test
npm run dry-run
npm run typecheck
```

## Environment

See `.env.example`. Required for live mode:

- `CURSOR_API_KEY`
- `OPENAI_API_KEY`
- `GITHUB_TOKEN` (later phases)
- `DATABASE_URL` / `REDIS_URL` (production)

Default `NADS_MODE=dry-run` uses mocks and never spends provider budget.

## Security boundaries

Allowed: code tasks on integration branches, tests, docs, PRs to integration branch.  
Forbidden: production deploys, production DB, reading production secrets into prompts, unlimited spend, disabling tests to force ACCEPT.
