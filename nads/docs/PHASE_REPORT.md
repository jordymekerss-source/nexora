# NADS Phase Report

**Updated:** 2026-11-11 (Europe/Amsterdam)  
**Branch:** `cursor/nads-openai-live-review-6aee`

## Phase 3 focus — Live Cursor Cloud Agent integration

### Investigated

- Existing `/nads` provider interface, HTTP adapter stub, mock loop, journal SQL schema
- Official Cursor Cloud Agents API v1 docs: https://prod.cursor.com/docs/cloud-agent/api/endpoints
- Auth: Basic (`-u KEY:`) or Bearer
- Idempotent create via client `agentId` → `409 agent_id_conflict`
- `409 agent_busy` / steer delivery / SSE `Last-Event-ID` resume / `410 stream_expired`
- GitHub adapter: keep for listing/checks; prefer Cursor `autoCreatePR` to avoid duplicate PRs

### Built / changed

| Item | Path |
|---|---|
| Typed Cursor errors | `nads/src/adapters/cursor-errors.ts` |
| Expanded provider types | `nads/src/adapters/cursor-agent-provider.ts` |
| Production HTTP provider | `nads/src/adapters/cursor-http-adapter.ts` |
| Fail-closed factory | `nads/src/adapters/cursor-factory.ts` |
| Execution journal (restart recovery) | `nads/src/db/execution-journal.ts` |
| Loop waits for terminal runs + journal | `nads/src/orchestrator/loop.ts` |
| CLI `cursor-smoke` / `provider-mode` | `nads/src/cli.ts` |
| Unit + gate tests | `nads/tests/cursor-*.test.ts`, `execution-journal.test.ts` |

### Endpoints used (verified)

- `POST /v1/agents`
- `GET /v1/agents/{id}`
- `POST /v1/agents/{id}/runs`
- `GET /v1/agents/{id}/runs`
- `GET /v1/agents/{id}/runs/{runId}`
- `GET /v1/agents/{id}/runs/{runId}/stream`
- `POST /v1/agents/{id}/runs/{runId}/cancel`

### Tests (this worker)

| Command | Result |
|---|---|
| `cd nads && npm test` | **PASS** — 39/39 |
| `cd nads && npm run typecheck` | **PASS** |
| `cd nads && npm run dry-run` | **PASS** — `REJECT` → `ACCEPT` |
| `NADS_MODE=live npm run provider-mode` | **PASS** — resolves `HttpCursorAgentProvider` with key present |
| `cd nads && npm run cursor-smoke` | **BLOCKED** — live `POST /v1/agents` returned `400 usage_limit_exceeded` (prepaid balance used up). Auth succeeded; no agent created. No automatic retry. |

### Live API evidence (redacted)

- `CURSOR_API_KEY`: accessible and non-empty after user secret entry
- Request: `POST https://api.cursor.com/v1/agents` (Basic auth)
- Response: `400` / `usage_limit_exceeded` — prepaid balance exhausted
- Conclusion: integration wiring + credentials OK; Cursor billing must be topped up before a full agent/run/branch smoke can PASS

### Remaining blockers

- Cursor prepaid balance / auto top-up required for live agent execution
- Postgres/Redis production workers still optional (journal file bridges restart recovery)
- Dashboard UI not started

### Next phase

Top up Cursor billing → re-run `npm run cursor-smoke` once for live agent/branch evidence → Control Center dashboard skeleton.
