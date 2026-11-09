# SECURITY_TEST_REPORT

**Date:** 2026-11-10 (Europe/Amsterdam)  
**Branch:** `cursor/nexora-critical-repair-5233`

## Executed

| Test | Type | Result | Notes |
|---|---|---|---|
| `resolveSignupBootstrap` rejects `super_admin` | Unit | **PASS** | `src/lib/auth/signup-policy.test.ts` |
| Rejects `employer` + arbitrary tenant metadata | Unit | **PASS** | same |
| Rejects `employee` + arbitrary tenant without invite | Unit | **PASS** | same |
| Normal public registration → employee/null tenant | Unit | **PASS** | same |
| Valid invite binds invite-ledger tenant only | Unit | **PASS** | ignores malicious metadata |
| Demo gate / runtime fail-closed | Unit | **PASS** | existing mode/env tests |
| Auth open redirect sanitizer | Unit | **PASS** | `safe-redirect.test.ts` |
| Money VAT/line cent math | Unit | **PASS** | |
| Time range validation | Unit | **PASS** | |
| `npm test` (full suite) | Unit | **PASS** | see TEST_REPORT |
| `tsc` / `lint` / `build` | Build | **PASS** | see TEST_REPORT |
| Direct Supabase signup with manipulated metadata | Integration | **GEBLOKKEERD** | No live Supabase project in worker; apply migrations then run `supabase/tests/p0_auth_privilege.sql` |
| Direct PostgREST update of approved time entry | Integration | **GEBLOKKEERD** | Same — SQL policy present in `20251110000000_*` |

## Required live verification (when Supabase available)

1. Apply migrations through `20251110010000_*`
2. Attempt anon/authenticated `signUp` with `data: { role: 'super_admin', tenant_id: '<uuid>' }` → profile must be `employee` / `tenant_id null`
3. Attempt same with `role: 'employer'` → still `employee` / null
4. Employer invite → `tenant_invites` row → accept invite → employee profile with that tenant only
5. As employee JWT, `PATCH time_entries` where `status=approved` → denied
