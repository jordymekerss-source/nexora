# COMPLETE CODE AUDIT — NEXORA BUSINESS OS

**Date:** 2026-11-11 (Europe/Amsterdam)  
**Branch:** `cursor/nexora-audit-playwright-5233`  
**Method:** Code inspection + existing unit tests. Live PostgREST/SQL against a real Supabase project was **not** available in this worker.

## 1. Architecture inventory

| Area | Location | Notes |
|---|---|---|
| Framework | Next.js 14.2.35 App Router, React 18, TS, Tailwind | `package.json` |
| Auth/DB | Supabase SSR + Postgres RLS | `@supabase/ssr` 0.5.2, `supabase-js` 2.49.8 |
| Middleware | `src/middleware.ts` | Cookie session refresh; demo bypass when `NEXT_PUBLIC_DEMO_MODE=true` |
| Server actions | `src/app/actions/{crm_billing,ops}.ts`, dashboard `*/actions.ts` | Primary mutation surface |
| API routes | `src/app/api/health/route.ts` only | |
| Demo store | `src/lib/demo/*`, `.data/demo-store.json` | Explicit opt-in |
| Modules | `src/modules/*` | Phase-1 scaffolds + documents/accountant/integrations services |
| Migrations | `supabase/migrations/20251106*` … `20251111*` | Additive only |
| Unit tests | Vitest | No Playwright prior to this session |
| Dual UI trees | `/dashboard/*` and `/employer/*` + `/employee/*` | Overlap / navigation debt |

### Migrations (ordered)

1. `20251106190000_initial_schema.sql` — tenants, profiles, projects, time, photos, RLS  
2. `20251106220000_quotes_invoices.sql` — quotes/invoices + item RLS via parent  
3. `20251109220000_clients_crm_planning.sql` — clients, schedules  
4. `20251109230000_ops_modules.sql` — assignments, fleet, tools, certs, work orders  
5. `20251109240000_foundation_audit_time.sql` — audit, breaks, corrections, module_configs  
6. `20251109250000_security_hardening.sql` — signup/RLS/integrity triggers (superseded partially)  
7. `20251109260000_mvp_stabilize.sql` — document sequences, storage tighten  
8. `20251110000000_critical_repair_auth_time.sql` — invite ledger, hard signup lock, time status rules  
9. `20251110010000_atomic_billing_rpc.sql` — quote create + convert RPCs  
10. `20251111000000_phase1_foundation_dms_accountant.sql` — DMS, accountant, outbox  

---

## 2. Traceable findings

### AUD-001 — Signup privilege via `raw_user_meta_data` (historical)

| Field | Value |
|---|---|
| Path | `supabase/migrations/20251106190000_initial_schema.sql` → superseded by `20251110000000_critical_repair_auth_time.sql` `handle_new_user()` |
| Implementation now | Always inserts `role = 'employee'`; `tenant_id` only from `tenant_invites` when `invited_at` set; ignores metadata role/tenant |
| App signup | `src/app/(auth)/signup/page.tsx` sends only `full_name` |
| Onboarding elevate | `create-organization/page.tsx` uses **service role** admin client |
| Status | **MITIGATED IN REPO** |
| Live proof | **GEBLOKKEERD** (no Supabase) |
| Risk if migration not applied | **Critical** |
| Regression | Unit `signup-policy.test.ts`; live SQL when available |

### AUD-002 — Silent demo fallback when Supabase missing (historical)

| Field | Value |
|---|---|
| Path | `src/lib/demo/mode.ts`, `src/lib/supabase/public-env.ts`, `src/lib/runtime/env.ts`, `src/app/layout.tsx` |
| Implementation now | `isDemoMode()` requires `NEXT_PUBLIC_DEMO_MODE===true`; live missing URL/key **throws**; prod demo requires `ALLOW_DEMO_IN_PRODUCTION=true` |
| Status | **MITIGATED IN REPO** |
| Residual | This worker’s `.env.local` enables demo intentionally for the public demo host — not a silent fallback |
| Risk | Low (code); ops misconfig still possible |
| Regression | `mode.test.ts`, `env.test.ts` |

### AUD-003 — Employee reopen/edit approved time entries

| Field | Value |
|---|---|
| Path | `time_entries_update` policy + `enforce_time_entry_status_rules` in `20251110000000_*` |
| Implementation now | Employee USING/CHECK requires `status='pending'`; trigger blocks approved edits and status changes |
| Status | **MITIGATED IN REPO** |
| Live proof | **GEBLOKKEERD** |
| Risk if not applied | **High** |
| Reproduction (expected deny) | As employee JWT: `PATCH /rest/v1/time_entries?id=eq.<approved>` `{ "notes": "x" }` → 0 rows / error |

### AUD-004 — Employer can mutate approved entries without correction audit

| Field | Value |
|---|---|
| Path | RLS `time_entries_update` allows full employer update; `correctTimeEntryFormAction` in `ops.ts` |
| Problem | Employer PostgREST update of approved rows does not require `time_entry_corrections`. App correction action is **demo-only** (`redirect ... error=mode` when live). |
| Reproduction | 1) Live employer session 2) submit correction UI → `?error=mode` OR 3) direct `update time_entries set clock_out=... where status=approved` as employer → succeeds without correction row |
| Risk | **High** (audit integrity / arbeidsregistratie) |
| Proposed fix | SECURITY DEFINER `correct_time_entry(...)` RPC; revoke direct employer UPDATE of approved rows; wire live action |
| Regression | Unit + e2e demo correction; SQL deny when live |

### AUD-005 — Non-atomic invoice-from-hours

| Field | Value |
|---|---|
| Path | `generateInvoiceFromApprovedHours` in `src/app/actions/crm_billing.ts` (~L515–590) |
| Problem | Separate `invoices.insert` then `invoice_items.insert`; manual delete on item failure — not a DB transaction; concurrent double-submit can duplicate |
| Reproduction | Trigger two parallel server actions for same project with approved hours |
| Risk | **High** (financial integrity) |
| Status of quote create/convert | **MITIGATED** via `create_quote_with_items` / `convert_quote_to_project_invoice` |
| Proposed fix | Additive RPC `create_invoice_from_approved_time` + idempotency key |
| Regression | Unit mock + e2e demo path |

### AUD-006 — VAT rate not historically stored as document field

| Field | Value |
|---|---|
| Path | `quotes`/`invoices` store amounts; RPC hardcodes `0.21` |
| Problem | Rate change later cannot prove which rate applied; VAT codes not configurable |
| Risk | **Medium** |
| Proposed fix | Add `vat_rate_bps` (or percent) columns; pass into RPCs |
| Note | App money math uses cents helpers — good; DB still `numeric(10,2)` euros |

### AUD-007 — Child tables without `tenant_id` (quote_items, invoice_items)

| Field | Value |
|---|---|
| Path | `20251106220000_quotes_invoices.sql` |
| Implementation | RLS via join to parent quote/invoice tenant |
| Residual risk | No composite FK; relies on parent RLS + no direct orphan inserts across tenants |
| Risk | **Medium** (defense in depth) |
| Proposed | Optional `tenant_id` + composite FK in later migration; keep parent RLS |

### AUD-008 — Cross-tenant FK integrity on schedules/assignments

| Field | Value |
|---|---|
| Path | Triggers in `20251109250000_security_hardening.sql` |
| Status | **Present in repo** for project/user belonging to same tenant |
| Live proof | **GEBLOKKEERD** |

### AUD-009 — No Playwright / e2e suite

| Field | Value |
|---|---|
| Path | `package.json` scripts — only vitest |
| Risk | **High** for regression of authz/UI flows |
| Proposed | Install Playwright; demo-mode suites first; live security marked blocked |

### AUD-010 — Dual navigation trees / missing fine-grained permissions

| Field | Value |
|---|---|
| Path | `/dashboard` vs `/employer`; entitlements module-level only |
| Problem | No Layer 3 (CRUD permissions) or Layer 4 (data-scoped) beyond role + module |
| Risk | **Medium** (product/security model incomplete) |
| Proposed | Permission schema + mobile/universal session bootstrap (architecture first) |

### AUD-011 — Accountant role not routed

| Field | Value |
|---|---|
| Path | `requireDashboardSession` + Phase-1 `accountant` role |
| Problem | `tenant_id null` accountants redirected to create-organization |
| Risk | **Medium** when portal enabled |
| Proposed | Dedicated accountant session gate |

### AUD-012 — Next.js 14.2.35 advisories

| Field | Value |
|---|---|
| Risk | **Medium/High** (supply-chain/CVE depending on advisory) |
| Proposed | Upgrade decision — requires approval (breaking) |

---

## 3. What this audit does **not** claim

- Live multi-tenant isolation is proven (it is **not**).  
- Certified bookkeeping or official BTW filing.  
- Full ERP modules complete.  
- Playwright tests passed before they are installed and executed.

## 4. Repair order for this session

1. AUD-004 / AUD-005 / AUD-006 additive migration + action wiring  
2. Playwright install + demo e2e + security attempt suites  
3. Universal mobile + 4-layer permission architecture docs/scaffold  
4. Final verification report with real execution results  
