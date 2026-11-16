# Security Threat Model (V2)

## Assets

Tenant business data, employee PII, financial documents, support credentials.

## Key threats & mitigations

| Threat | Mitigation | Status |
| --- | --- | --- |
| Cross-tenant read/write | RLS + authorize tenant match | Partial (SQL tests blocked without DB) |
| Employee opens unassigned project | Layer-4 scopes; null scope_id never wildcards | Code VERIFIED (unit) |
| Super Admin silent tenant access | support_access_grants required | Code + migration |
| Module disable bypass | fail-closed resolve | VERIFIED |
| Expired feature revival via defaults | deterministic feature resolver | VERIFIED |
| Privilege via signup metadata | onboarding RPC / server path only | Partial |
| Demo cookie as prod identity | demo mode isolation | Partial |
| SECURITY DEFINER search_path hijack | pin `pg_catalog, public` | Migration added for key fns |

## Open P0/P1

- Live RLS proof against two tenants: **BLOCKED**
- Wire authorize() on every mutation: **IN_PROGRESS**
- Full SECURITY DEFINER inventory hardening: **IN_PROGRESS**
