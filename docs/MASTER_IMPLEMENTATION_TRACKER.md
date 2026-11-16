# NEXORA Master Implementation Tracker — Ultimate Product V2

Branch: `cursor/nexora-ultimate-product-v2-5233`  
Base: `cursor/nexora-premium-full-build-5233` @ `c2d8acb`  
Laatste update: 2026-11-16 (Europe/Amsterdam)

| ID | Prio | Module | Beschrijving | Bestanden | Status | Testbewijs | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V2-P0-01 | P0 | AuthZ | hasDataAccess deny-by-default; geen project-B via A | `permissions/evaluate.ts` | VERIFIED | unit | TBD |
| V2-P0-02 | P0 | AuthZ | Super Admin geen tenant-data zonder support grant | `evaluate.ts`, migratie support grants | VERIFIED | unit | TBD |
| V2-P0-03 | P0 | Entitlements | Feature expiry + geen default-revive | `feature-resolve.ts` | VERIFIED | unit | TBD |
| V2-P0-04 | P0 | AuthZ | Centrale `authorize()` | `authorization/authorize.ts` | VERIFIED | unit; wired time actions | TBD |
| V2-P0-05 | P0 | Time | Strikte datetime/break validatie | `time/parse.ts`, `time/actions.ts` | VERIFIED | unit | TBD |
| V2-P0-06 | P0 | DB | Scope NULL integrity + numbering grant | `20251116230000_*.sql` | IMPLEMENTED_UNVERIFIED | SQL niet gedraaid | TBD |
| V2-P0-07 | P0 | Onboarding | Atomic create_organization RPC | `20251116231000_*.sql`, page | IMPLEMENTED_UNVERIFIED | geen live DB | TBD |
| V2-NAV-01 | P1 | UX | Module-aware navigatie | `nav-config.ts`, AppShell | VERIFIED | unit + e2e | TBD |
| V2-CI-01 | P1 | QA | CI op cursor/** branches | `.github/workflows/ci.yml` | IMPLEMENTED_UNVERIFIED | lokale e2e 18/18 | TBD |
| V2-RLS-01 | P0 | Security | Live multi-tenant RLS | supabase tests | BLOCKED | geen testdb | — |
| V2-OFF-01 | P1 | Offline | Sync implementatie | docs | NOT_STARTED | — | — |
| V2-MOB-01 | P2 | Mobile | Expo shell | docs | NOT_STARTED | — | — |

## Test summary (local)

- typecheck ✓
- lint ✓
- unit 81/81 ✓
- e2e 18/18 ✓
- postgres integration: BLOCKED
