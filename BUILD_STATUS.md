# BUILD_STATUS

**Updated:** 2026-11-09 23:55 Europe/Amsterdam  
**Branch:** `cursor/nexora-mvp-stabilize-5233`  
**Phase:** Stabilize Core MVP (security + entitlements + time corrections)  
**Canonical copy:** also `docs/BUILD_STATUS.md`

## Current phase

- [x] FASE 0 — Audit (docs written; evidence-based)
- [~] FASE 1 — Fundament (demo gate, Vitest, foundation migration, break start/stop demo)
- [ ] FASE 2 — Core platform
- [ ] FASE 3 — Daily operations
- [ ] FASE 4 — Ops modules depth
- [ ] FASE 5 — Admin/CRM depth
- [ ] FASE 6 — Comms/integrations
- [ ] FASE 7 — PWA
- [ ] FASE 8 — Production control

## Completed this session

- Full audit + requirements matrix + master docs
- P0: explicit demo opt-in + production refuse unless `ALLOW_DEMO_IN_PRODUCTION`
- `/api/health`
- Vitest unit tests (money-cents, demo gate, time calc, safe redirect)
- Migration `20251109240000_foundation_audit_time.sql`
- Migration `20251109250000_security_hardening.sql` (signup lock, RLS tighten, tenant triggers)
- Auth callback open-redirect fix
- Employee real break start/stop (demo)

## Follow-up from deep security/DB/feature audits

Findings from [Audit auth security tenancy](bc-3cae540c-0247-5a9b-8ac5-a86390e5ce41), [Audit features vs routes](bc-4b02457a-7735-56db-b4a3-9998f81373e1), and [Audit database schema RLS](bc-1035d86c-24fc-5128-aae2-6b815e1d823d) incorporated into docs + P0 SQL/app fixes above.

## Next

1. Apply new SQL migrations on the real Supabase project
2. Wire ops + breaks to live Supabase
3. Employer time correction UI
4. Super Admin scaffold
5. Decide Next.js major upgrade

## Blocked / needs decision

- Next 14 → 16 for critical advisories (breaking)
- Live Supabase for RLS proof tests
- Paid integration keys

## Tests run

- `tsc --noEmit` PASS
- `npm test` (incl. redirect tests)
- `npm run build` PASS
- `npm audit` FAIL (known Next advisories)

## Production readiness

**Not production-ready.**
