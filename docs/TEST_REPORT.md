# TEST_REPORT

**Updated:** 2026-11-09 (Europe/Amsterdam)  
**Branch:** `cursor/nexora-mvp-stabilize-5233`

## Commands executed this stabilize pass

| Command | Result |
|---|---|
| `npm test` | **PASS** — 23 tests / 8 files |
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |
| Live Supabase RLS Tenant A/B | **GEBLOKKEERD** — no Supabase project in worker |
| Playwright e2e | **NIET UITGEVOERD** — not installed yet (avoid scope creep without need) |

## Unit coverage (Vitest)

- Demo mode gate
- Runtime env fail-closed
- Auth safe redirect
- Money cent-backed VAT/line totals
- Time range validation
- Module entitlement key defaults

## Security tests still required on real Supabase

1. Signup cannot create `super_admin`
2. Signup cannot attach foreign `tenant_id` without invite
3. Tenant A cannot read Tenant B rows via PostgREST
4. Employee cannot update approved time entries
5. Storage employee cannot list peer uploads
