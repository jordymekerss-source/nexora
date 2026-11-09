# SECURITY_AUDIT

**Date:** 2026-11-09 (Europe/Amsterdam)  
**Branch baseline:** `cursor/nexora-mvp-stabilize-5233` (from `cursor/nexora-master-audit-5233@4e0a207`)  
**Method:** Static code + migration review; unit tests for gates/redirects; **no live Supabase JWT RLS exercise in this worker** (demo env only).

Status legend: BEWEZEN PROBLEEM | VERMOEDEN | NIET GETEST | GEBLOKKEERD | OPGELOST

---

## P0 findings

| ID | Status | Risk | Location | Description | Proof / fix |
|---|---|---|---|---|---|
| SEC-A-001 | OPGELOST | Critical | `handle_new_user` historically accepted `super_admin` + any `tenant_id` from metadata | Self-serve privilege escalation / tenant join | Fixed in `20251109250000_security_hardening.sql`; invite-only tenant attach via `invited_at` |
| SEC-A-002 | OPGELOST | Critical | `src/app/auth/callback/route.ts` | Open redirect via `?next=` | Fixed with `safeInternalPath` + unit tests |
| SEC-A-003 | OPGELOST | Critical | `src/lib/demo/mode.ts` (old) | Missing Supabase env ⇒ demo | Explicit `NEXT_PUBLIC_DEMO_MODE=true` only; prod needs `ALLOW_DEMO_IN_PRODUCTION` |
| SEC-A-004 | OPGELOST | High | `time_entries_update` RLS | Employee could target approved rows in USING | USING/WITH CHECK require `status = 'pending'` |
| SEC-A-005 | OPGELOST | High | `profiles_update_employer` | Employer could escalate peer roles | Employers may only update `employee` peers |
| SEC-A-006 | OPGELOST | High | Ops tables without tenant FK triggers | Cross-tenant FK if RLS bypassed | Triggers in hardening migration |
| SEC-A-007 | BEWEZEN PROBLEEM → mitigated in app | High | `src/middleware.ts` | Session refresh only; no route ACL | Middleware ACL added in stabilize branch |
| SEC-A-008 | NIET GETEST | High | Live RLS | Tenant A vs B isolation | **GEBLOKKEERD** without Supabase project in worker |
| SEC-A-009 | BEWEZEN PROBLEEM | Critical | `npm audit` Next 14.2.35 | Known critical advisories | Upgrade decision required (breaking) |
| SEC-A-010 | BEWEZEN PROBLEEM | High | Live HTTP `:3000` demo | No TLS | Documented; proxy not deployed without approval |

## P1 findings

| ID | Status | Risk | Description | Action |
|---|---|---|---|---|
| SEC-B-001 | BEWEZEN PROBLEEM | High | Public signup still offers employee role in UI | Force employer-only public signup |
| SEC-B-002 | PARTIAL / VERMOEDEN | High | Storage employee SELECT may list tenant folder | Tighten storage policies in migration |
| SEC-B-003 | BEWEZEN PROBLEEM | Medium | No rate limiting on auth/actions | Document; add later |
| SEC-B-004 | BEWEZEN PROBLEEM | Medium | Feature entitlements were UI-only / absent | Server-side entitlement service |
| SEC-B-005 | BEWEZEN PROBLEEM | Medium | Float money in billing path | Cents helpers + gradual adoption |

## Reproduction notes

- **SEC-A-001 (historical):** Crafted `signUp({ data: { role: 'super_admin' }})` would have been accepted by old trigger. Current trigger rejects non-employer/employee and never sets super_admin. Live DB must apply migration to be protected.
- **SEC-A-002:** `GET /auth/callback?code=…&next=https://evil.example` previously redirected off-site; now falls back to `/dashboard`.
- **SEC-A-008:** Cannot execute PostgREST JWT tests here — no Supabase credentials beyond demo mode.

## Residual risk (honest)

Until migrations are applied on the real Supabase project **and** Next is upgraded **and** HTTPS is terminated, production use remains **not approved**.
