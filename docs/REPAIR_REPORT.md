# REPAIR_REPORT — Critical security & Core MVP repair

**Date:** 2026-11-10 (Europe/Amsterdam)  
**Branch:** `cursor/nexora-critical-repair-5233`  
**Method:** Reproduce via static analysis + unit policy tests; live Supabase PostgREST **GEBLOKKEERD** in this worker (demo-only env).

## Findings (before this repair)

| ID | Priority | Status before | Evidence |
|---|---|---|---|
| AUTH-META-001 | P0 | BEWEZEN (historical initial migration) | `handle_new_user` trusted `raw_user_meta_data.role` including `super_admin` and arbitrary `tenant_id` |
| AUTH-META-002 | P0 | BEWEZEN (partial harden remained) | Even after `20251109250000`, public signup could still set `employer` via metadata |
| TIME-RLS-001 | P0 | BEWEZEN (initial) / mitigated in `…250000` | Employee USING clause lacked `status='pending'` |
| DEMO-FALLBACK-001 | P1 | Mitigated earlier | Missing Supabase no longer enables demo; explicit opt-in required |
| BILLING-TX-001 | P1 | BEWEZEN | Live convert quote created project then invoice without single DB transaction |
| INVITE-META-001 | P1 | BEWEZEN | Invite membership trusted invite metadata `tenant_id` |

## Fixes shipped

### P0 Auth
- New migration `20251110000000_critical_repair_auth_time.sql`
  - `tenant_invites` ledger
  - `handle_new_user` **ignores** role/tenant metadata; always inserts `employee`
  - Invite membership only from open `tenant_invites` row matching email
  - Profile self-escalation trigger blocked
  - time_entries status rules trigger + RLS USING/CHECK pending
- Signup UI sends only `full_name` (no role/tenant)
- Create-organization elevates null-tenant user → employer via **service role** only
- Invite action inserts `tenant_invites` under employer RLS, then Admin email invite

### P0 Time
- RLS reaffirmed + BEFORE UPDATE status guard for employees
- App updates require `.eq('status','pending')` and fail closed if 0 rows
- Demo employer corrections remain append-only (`time_entry_corrections`)

### P1 Demo/prod
- Explicit demo only; live fails closed (`assertRuntimeConfiguration`, public-env errors)
- Demo JSON not used as silent production store

### P1 Tenant integrity
- Existing ops triggers retained
- Invoice/quote project/client ref triggers strengthened in critical repair migration

### P1 Billing atomicity
- `20251110010000_atomic_billing_rpc.sql`
  - `create_quote_with_items`
  - `convert_quote_to_project_invoice`
  - Uses `next_document_number` for concurrency-safe numbers
- Live TS paths call these RPCs; hour-invoice rolls back header if line insert fails

### P1 Time validation
- `validateClockRange` on dashboard time actions + project membership check

### P2 Entitlements
- Already present (`assertModuleEnabled`); kept after P0

## Explicit non-changes
- Did not rewrite CRM/demo UX that already works
- Did not rename `employer` → `company_admin` in storage (compat)
- Did not run destructive DB resets
