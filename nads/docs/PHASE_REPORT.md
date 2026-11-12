# NADS Phase Report

**Updated:** 2026-11-12 (Europe/Amsterdam)  
**Branch:** `cursor/nads-openai-live-review-6aee`

## P0+P1 — Automation executor prep (inactive)

### Decision

Preferred execution: **Automation webhook + GitHub event completion**.  
`HttpCursorAgentProvider` remains an **explicit optional** `NADS_EXECUTOR=cursor` fallback.  
**No automatic fallback** to prepaid-gated `POST /v1/agents`.

### Built

| Item | Path |
|---|---|
| Dispatch payload contracts | `nads/src/contracts/automation-payload.ts` |
| `TaskExecutor` + factory | `nads/src/adapters/executor.ts` |
| `AutomationExecutor` (send gated) | `nads/src/adapters/automation-executor.ts` |
| GitHub webhook verify + replay | `nads/src/ingress/github-webhook.ts` |
| Automation callback verify | `nads/src/ingress/automation-callback.ts` |
| Async dispatch/complete helpers | `nads/src/orchestrator/automation-lifecycle.ts` |
| GitHub PR/files reads | `nads/src/adapters/github-adapter.ts` |
| SQL additive migration | `nads/db/migrations/002_automation_executor.sql` |
| Tests | `executor-selection`, `automation-executor`, `github-webhook` |

### Activation state

- `NADS_AUTOMATION_ENABLED=false` (default)
- `NADS_ALLOW_CURSOR_API_SMOKE=false` (default)
- No live Automation jobs
- No `POST /v1/agents` from preferred flows

### Tests (this worker)

| Command | Result |
|---|---|
| `cd nads && npm test` | **PASS** — 55/55 |
| `cd nads && npm run typecheck` | **PASS** |
| `cd nads && npm run dry-run` | **PASS** |
| `cd nads && npm run executor-status` | mock; automationEnabled=false; no auto cursor fallback |
| `cd nads && npm run automation-dispatch-dry` | disabled send; no `/v1/agents` |
| `cd nads && npm run cursor-smoke` | **BLOCKED** unless `NADS_ALLOW_CURSOR_API_SMOKE=true` |

### Remaining blockers (activation)

1. Confirm Automations + webhook available on the account plan  
2. Create Automation, pin Composer/Grok, copy URL/key  
3. Configure GitHub webhook secret to NADS ingress when hosted  
4. Optionally enable on-demand with **low hard limit** — do **not** prepaid top-up / auto top-up for NADS  
5. Flip `NADS_AUTOMATION_ENABLED=true` only after eligibility verified  
