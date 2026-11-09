# TEST_REPORT

**Updated:** 2026-11-10 (Europe/Amsterdam)  
**Branch:** `cursor/nexora-critical-repair-5233`

## Commands

| Command | Result |
|---|---|
| `npm test` | **PASS** — 28 tests / 9 files |
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |
| Live Supabase auth/RLS | **GEBLOKKEERD** |
| Playwright e2e | **NIET UITGEVOERD** (not installed; avoid unpaid scope) |

## Unit files

- `src/lib/auth/signup-policy.test.ts` — privilege escalation contract
- `src/lib/auth/safe-redirect.test.ts`
- `src/lib/demo/mode.test.ts`
- `src/lib/runtime/env.test.ts`
- `src/lib/money*.test.ts`
- `src/lib/time*.test.ts`
- `src/lib/entitlements/check.test.ts`

See also `docs/SECURITY_TEST_REPORT.md` and `docs/TENANT_ISOLATION_TEST_REPORT.md`.
