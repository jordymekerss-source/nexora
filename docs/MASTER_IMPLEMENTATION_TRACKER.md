# NEXORA Master Implementation Tracker

Branch: `cursor/nexora-premium-full-build`  
Base tip (audit): `6a5804d42221d82aafc9782a3b88b053cc417a21`  
Laatste update: 2026-11-16 (Europe/Amsterdam)

Statuswaarden: `NOT_STARTED` | `IN_PROGRESS` | `IMPLEMENTED_UNVERIFIED` | `VERIFIED` | `BLOCKED`

| ID | Prio | Module | Beschrijving | Bestanden | Afhankelijkheden | Status | Testresultaat | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | P0 | Audit | Requirementsmatrix + tracker | `docs/MASTER_IMPLEMENTATION_TRACKER.md` | — | VERIFIED | Docs aanwezig | post-commit |
| B-01 | P0 | Security | Module entitlements fail-closed | `src/lib/entitlements/resolve.ts`, `check.ts` | — | VERIFIED | unit 55/55 | post-commit |
| B-02 | P0 | Security | Fine-grained permissions model | `src/lib/permissions/*`, migratie `20251111220000_*` | B-01 | IMPLEMENTED_UNVERIFIED | unit evaluate OK; actions partial | post-commit |
| B-03 | P0 | Auth | Ongeldige demo-persona ≠ employer | `src/lib/demo/persona.ts` | — | VERIFIED | persona unit + e2e auth | post-commit |
| B-04 | P0 | RLS | Cross-tenant isolation proof | `supabase/tests/p0_security_regression.sql` | Live Supabase | BLOCKED | Geen testdb | — |
| C-01 | P0 | Demo | Geserialiseerde atomische demo-store | `src/lib/demo/store.ts` | — | IMPLEMENTED_UNVERIFIED | e2e indirect | post-commit |
| C-02 | P0 | Finance | Integer-cents / btw / nummers | `src/lib/money.ts`, migratie numbering | — | VERIFIED | money unit | post-commit |
| D-01 | P1 | Live | Ops actions buiten demo | `src/app/actions/ops.ts` | Supabase | BLOCKED | Geen live project | — |
| E-01 | P1 | UX | Design tokens + light theme | `globals.css`, `tailwind.config.ts` | — | IMPLEMENTED_UNVERIFIED | e2e pages laden | post-commit |
| E-02 | P1 | UX | AppShell navigatie redesign | `src/components/app/AppShell.tsx` | E-01 | VERIFIED | e2e 18/18 | post-commit |
| F-01 | P1 | UI | Kernschermen light-theme sweep | `src/app/**` | E-01 | IMPLEMENTED_UNVERIFIED | e2e CRM OK | post-commit |
| H-01 | P1 | Offline | Sync-architectuur | `docs/OFFLINE_SYNC_ARCHITECTURE.md` | — | IMPLEMENTED_UNVERIFIED | docs only | post-commit |
| I-01 | P2 | Mobile | Universele app voorbereiding | `docs/UNIVERSAL_MOBILE_ARCHITECTURE.md` | — | IMPLEMENTED_UNVERIFIED | docs only | post-commit |
| J-01 | P0 | QA | Playwright core + security suites | `tests/e2e/*` | demo mode | VERIFIED | e2e 18/18 | post-commit |
| K-01 | P0 | Docs | Production readiness / security gate | `docs/PRODUCTION_READINESS.md` e.a. | J-01 | VERIFIED | Docs | post-commit |

## Requirementsmatrix (kern)

| Req | Rol | Doel | Implementatie | DB | Authz | Status | Risico |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-AUTH-01 | allen | Veilige sessie | Supabase Auth + demo cookie isolatie | auth | middleware | gedeeltelijk | Hoog zonder live proof |
| R-ENT-01 | employer | Modules aan/uit | `module_configs` + fail-closed resolve | module_configs | assertModuleEnabled | werkend (code) | Was open; nu dicht |
| R-PERM-01 | employer | Fine-grained acts | permissions evaluate + migratie | role_permissions | deny-default | gedeeltelijk | Wire alle actions |
| R-TIME-01 | employee | In/uit/pauze | demo ops + employee UI | time_entries | employee session | demo werkend | Live BLOCKED |
| R-BILL-01 | employer | Facturen/offertes | crm_billing + money helpers | invoices/quotes | employer | demo werkend | Live BLOCKED |
| R-CRM-01 | employer | Klanten | employer/clients | clients | employer | demo werkend | — |
| R-PLAN-01 | employer | Planning | employer/planning | schedules | employer | gedeeltelijk | DnD/conflicts later |
| R-OFF-01 | employee | Offline sync | architectuurdoc | — | — | ontbrekend code | Hoog |
| R-STOR-01 | allen | Object storage | demo data-URL; live scaffold | storage | tenant path | gedeeltelijk | Productie ongeschikt |
| R-MOB-01 | allen | Universele app | PWA/docs | — | role/modules | voorbereid | Store niet publiceren |
