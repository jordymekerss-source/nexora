# NADS — NEXORA Autonomous Development System Architecture

**Date:** 2026-11-11 (Europe/Amsterdam)  
**Phase:** 1 (audit) + 2 (orchestrator basis)  
**Repo:** `https://github.com/jordymekerss-source/nexora`  
**Placement:** `/nads` — **logically separated** from the customer-facing Next.js SaaS under `/src`.

## 1. Existing situation (verified)

| Area | Finding |
|---|---|
| App | Next.js 14.2.35 + React 18 + Supabase SaaS MVP |
| Tests | Vitest unit + Playwright e2e (demo mode) |
| CI | `.github/workflows/playwright.yml` only |
| Packages | Single root package — no monorepo workspaces yet |
| Control plane | **Absent** before this work |
| Postgres/Redis on worker | Not installed — NADS uses SQL migrations + in-memory runtime for local/tests |

## 2. Desired situation

A dedicated orchestrator that:

1. Selects the next development task from a prioritized roadmap.  
2. Generates a Cursor prompt (OpenAI planner).  
3. Starts a Cursor Cloud Agent run via **verified** `https://api.cursor.com/v1` endpoints.  
4. Collects run status, artifacts, git refs.  
5. Runs / records quality gates (typecheck, unit, e2e) when available.  
6. Sends evidence to OpenAI structured review → `ACCEPT` / `REJECT` / `BLOCKED`.  
7. On reject: recovery prompt + continue run (max retries).  
8. On accept: mark task complete, pick next.  
9. Honors emergency stop, budgets, locks, idempotent events.

## 3. Verified external APIs (no invented endpoints)

### Cursor Cloud Agents API v1 (public beta)

Source: [cursor.com/docs/cloud-agent/api/endpoints](https://cursor.com/docs/cloud-agent/api/endpoints)

Auth: Basic (`API_KEY:`) or Bearer.

| Method | Path | Use |
|---|---|---|
| POST | `/v1/agents` | Create agent + initial run |
| GET | `/v1/agents` | List agents |
| GET | `/v1/agents/{id}` | Get agent |
| POST | `/v1/agents/{id}/runs` | Follow-up / continue |
| GET | `/v1/agents/{id}/runs` | List runs |
| GET | `/v1/agents/{id}/runs/{runId}` | Get run |
| GET | `/v1/agents/{id}/runs/{runId}/stream` | SSE stream |
| POST | `/v1/agents/{id}/runs/{runId}/cancel` | Cancel |
| GET | `/v1/agents/{id}/usage` | Usage |
| POST | `/v1/agents/{id}/archive` | Archive |
| DELETE | `/v1/agents/{id}` | Delete |

**Webhooks:** docs state webhooks are *coming soon* for v1; legacy v0 still has them. NADS therefore uses **polling + GitHub webhooks**, not invented Cursor webhooks.

Adapter interface: `CursorAgentProvider` → `HttpCursorAgentProvider` (real) / `MockCursorAgentProvider` (tests / dry-run).

### OpenAI API

- Official Node SDK: `openai` (installed **only** in `/nads`, never in the SaaS frontend bundle).  
- Chat Completions Structured Outputs: `client.chat.completions.parse` + `zodResponseFormat`.  
- Docs: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [openai-node](https://github.com/openai/openai-node).  
- Model pinned via `NADS_OPENAI_MODEL` (default `gpt-4o-mini`; never hardcode secrets).  
- `NADS_MODE=dry-run` → `HeuristicReviewer`; `live` + key → `OpenAIReviewer`.

### GitHub

- Official REST (`https://api.github.com`) via `HttpGitHubAdapter` when `GITHUB_TOKEN` is set.  
- Draft PRs only in this phase; never auto-merge to `main` / production. Integration branch only (e.g. `cursor/integration`).

## 4. Components

```
nads/
  docs/                 Architecture + phase reports
  db/migrations/        PostgreSQL DDL for control-plane DB
  src/
    adapters/           Cursor, OpenAI, GitHub
    orchestrator/       State machine driver, budgets, locks
    db/                 Repository interfaces + memory impl
    review/             Review schemas
    cli.ts              CLI entry
```

## 5. Data flow

```
Task READY
  → CONTEXT_GATHERING (repo metadata / prior reviews)
  → PROMPT_CREATED (OpenAI planner or template)
  → AGENT_QUEUED / AGENT_RUNNING (Cursor POST /v1/agents or /runs)
  → TESTING (record commands/results; optional local gates)
  → REVIEWING (OpenAI structured review)
  → ACCEPTED → NEXT_TASK
     or REVISION_REQUIRED → PROMPT_CREATED (≤ max_retries)
     or BLOCKED / STOPPED
```

## 6. Security model

- Secrets only via env; never logged.  
- Control plane DB ≠ SaaS tenant DB.  
- `emergency_stop` blocks new agent starts.  
- Budget caps daily/monthly/run.  
- No production deploy actions.  
- No silent ACCEPT without evidence fields populated.

## 7. Implementation phases

| Phase | Status |
|---|---|
| 1 Architecture + audit | Done |
| 2 DB + orchestrator basis | Done (memory store + SQL schema) |
| 3 GitHub adapter | HTTP adapter + env factory (token-gated) |
| 4 Cursor HTTP adapter | Implemented against v1 docs |
| 5 GPT reviewer | Official SDK + strict schema + review-smoke |
| 6 Live Cursor provider | HTTP adapter + SSE/poll wait + fail-closed factory + journal |
| 7–10 | Dashboard, Postgres/Redis workers, security hardening, full e2e autonomy |

## 8. Acceptance criteria (Phase 1–2)

- [x] Architecture documents verified APIs with sources  
- [x] Separate `/nads` package not imported by SaaS runtime  
- [x] State machine rejects illegal transitions (unit tested)  
- [x] Mock end-to-end loop: create → reject → recover → accept  
- [x] Official OpenAI SDK reviewer path (server-side `/nads` only)  
- [x] GitHub HTTP adapter (draft PRs; requires `GITHUB_TOKEN` for live)  
- [x] Live Cursor HTTP provider (unit-tested; live smoke gated on `CURSOR_API_KEY`)  
- [x] Fail closed when `NADS_MODE=live` without `CURSOR_API_KEY`  
- [x] Execution journal for restart / duplicate-create prevention  
- [ ] Live Cursor smoke PASS — blocked until `CURSOR_API_KEY` is provisioned  
- [ ] PostgreSQL/Redis/BullMQ production wiring — schema ready; memory + `.nads/execution-journal.json` for now  
