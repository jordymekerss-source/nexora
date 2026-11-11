# NADS Phase Report

**Updated:** 2026-11-11 (Europe/Amsterdam)  
**Branch:** `cursor/nads-openai-live-review-6aee` (from `cursor/nads-orchestrator-5233`)

## Investigated (this phase)

- Prior NADS phases 1–2 on `/nads` (state machine, mock loop, raw-fetch OpenAI reviewer)
- Official OpenAI Node SDK `openai@7.55.0` (requires Node `>=22`)
- Structured Outputs via `chat.completions.parse` + `zodResponseFormat`
- Docs: https://developers.openai.com/api/docs/guides/structured-outputs
- GitHub REST adapter surface (draft PRs only; no production merge)

## Built / changed

| Item | Path |
|---|---|
| Official OpenAI SDK dependency | `nads/package.json` (not root SaaS) |
| SDK OpenAIReviewer | `nads/src/adapters/openai-reviewer.ts` |
| Reviewer factory (`NADS_MODE`) | `createReviewerFromEnv` |
| Strict review JSON Schema | `nads/src/review/schema.ts` |
| HTTP GitHub adapter | `nads/src/adapters/github-adapter.ts` |
| CLI: `review-smoke`, `github-status`, `reviewer-mode` | `nads/src/cli.ts` |
| Unit tests | `nads/tests/openai-reviewer.test.ts`, `github-adapter.test.ts` |

## Tests executed (this worker)

| Command | Result |
|---|---|
| `cd nads && npm test` | **PASS** — 18/18 |
| `cd nads && npm run typecheck` | **PASS** |
| `cd nads && npm run dry-run` | **PASS** — decisions `REJECT` → `ACCEPT`, final `NEXT_TASK` |
| `cd nads && npm run review-smoke` | **PASS** — one live call, model `gpt-4o-mini`, decision `ACCEPT`, ~2.5s |
| `cd nads && npm run github-status` | **PASS** — correctly reports unconfigured (no `GITHUB_TOKEN`) |
| Root `package.json` openai dep | **Absent** (SDK only under `/nads`) |

## Security notes

- `openai` installed only under `/nads` — not in the Next.js/browser dependency tree
- CLI redacts `sk-` / `ghp_` / `github_pat_` patterns in printed output
- Errors never intentionally echo Authorization headers or API keys
- GitHub adapter creates **draft** PRs only; no auto-merge / production deploy

## Still blocked / next

- Live Cursor `POST /v1/agents` — needs `CURSOR_API_KEY`
- Postgres/Redis/BullMQ production workers
- Development Control Center UI
- Live GitHub calls — needs `GITHUB_TOKEN` (adapter ready; `github-status` reports config)

## Next phase

Wire live Cursor provider selection behind `NADS_MODE=live` + `CURSOR_API_KEY`, then dashboard skeleton.
