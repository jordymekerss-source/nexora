# CURRENT SECURITY AUDIT — 2026-11-11 (Europe/Amsterdam)

**Branch:** `cursor/nexora-audit-playwright-5233`  
**Method:** Code verification against additive migrations + unit/e2e execution.  
**Live PostgREST against Supabase:** **GEBLOKKEERD** (no project credentials in worker).

## Architecture inventory (summary)

| Area | Location |
|---|---|
| Next.js 14 App Router | `src/app/**` |
| Middleware ACL | `src/middleware.ts` |
| Demo auth | `src/lib/demo/*`, `/login` demo accounts |
| Server actions | `crm_billing.ts`, `ops.ts`, dashboard actions |
| Migrations | through `20251111220000_p0_numbering_permissions.sql` |
| Permissions evaluators | `src/lib/permissions/*` |
| Playwright | `tests/e2e/*`, `playwright.config.ts` |

## P0 findings — re-verified

| ID | Topic | Current code status | Live proof |
|---|---|---|---|
| P0-1 | `handle_new_user` metadata privilege | **MITIGATED** in `20251110000000_*` — always `employee`; tenant only via `tenant_invites` | GEBLOKKEERD |
| P0-2 | Approved time employee edits | **MITIGATED** RLS+trigger `20251110000000` + employer correction gate `20251111010000` + `correct_time_entry` RPC | GEBLOKKEERD |
| P0-3 | Silent demo fallback | **MITIGATED** — explicit `NEXT_PUBLIC_DEMO_MODE===true`; live missing env throws | Unit PASS |
| P0-4 | `next_document_number` cross-tenant | **FIXED this session** — tenant mismatch raise in `20251111220000_*` | GEBLOKKEERD |

## P1 finance — re-verified

| ID | Topic | Status |
|---|---|---|
| P1-1 | Quote create / convert atomicity | Live path uses RPCs; demo uses single store write |
| P1-2 | Invoice from hours atomicity | `create_invoice_from_approved_time` + idempotency |
| P1-3 | Document numbering concurrency | `document_sequences` upsert; now tenant-locked |
| P1-4 | Money math | App uses eurocent helpers; DB still `numeric(10,2)` |
| P1-5 | Historical VAT rate | `vat_rate_bps` on quotes/invoices |

## Tenant isolation

RLS present on core tables; integrity triggers for many FKs.  
**Live A≠B tests:** GEBLOKKEERD. Checklist: `supabase/tests/p0_security_regression.sql`.

## Playwright

Installed; suites under `tests/e2e/`. See `docs/E2E_TEST_RESULTS.md` after execution.

## Remaining risks

1. Migrations not applied on production Supabase → historical bugs remain live.  
2. Layer 3/4 permission tables exist but not fully enforced in every Server Action.  
3. Next.js 14.2.35 advisories — upgrade needs approval.  
4. No mobile binary yet — architecture only.  
5. Composite FKs on quote_items/invoice_items still defense-in-depth gap.
