# TENANT_ISOLATION_TEST_REPORT

**Date:** 2026-11-10 (Europe/Amsterdam)

## Status summary

| Area | Status |
|---|---|
| Schema RLS present on business tables | PASS (migrations) |
| Cross-tenant FK triggers (ops + invoices/quotes) | PASS (migrations present) |
| Live Tenant A vs Tenant B PostgREST suite | **GEBLOKKEERD** — no Supabase in worker |
| Demo store isolation | N/A — single shared demo tenant by design |

## Planned live cases (not executed here)

Create Tenant A / Tenant B with employer+employee each, then:

1. Employee A opens project B by UUID → deny  
2. Employer A reads invoice B → deny  
3. Server Action with forged IDs from B → deny  
4. Storage download B path → deny  
5. Search leaking B → deny  
6. Self-update `profiles.tenant_id` → deny (trigger)  
7. Revoked/missing membership → deny  

SQL harness stub: `supabase/tests/tenant_isolation_checklist.md`
