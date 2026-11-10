# SECURITY_SPEC

## Baseline (repo)

- SSR cookie sessions via `@supabase/ssr`
- Roles: `super_admin` | `employer` | `employee` | `accountant` (Phase 1)
- Super Admin / accountant never via user_metadata on signup
- Tenant membership via `tenant_invites` ledger
- RLS on tenant tables with `current_tenant_id()`
- Demo mode explicit opt-in; live fail-closed without Supabase env

## Phase 1 additions

- Private `documents` storage bucket; path `tenants/{tenant_id}/...`
- Server-side upload policy (MIME + magic + size + quota)
- Accountant access only via `accountant_access_grants` (explicit, revocable)
- Accountant cannot see other tenants of same entrepreneur without separate grant
- Feature entitlements with expiry

## Still open / blocked

| Item | Status |
|---|---|
| Live Tenant A≠B PostgREST proof | GEBLOKKEERD — no Supabase in worker |
| Apply Phase 1 migration on production | Pending operator |
| Antivirus scanning worker | ONTBREEKT |
| Next.js advisory upgrade | OPEN |
| HTTPS termination | Ops / deployment |

See also: `docs/SECURITY_AUDIT.md`, `docs/SECURITY_TEST_REPORT.md`, `docs/FOUNDATION_GATE.md`.
