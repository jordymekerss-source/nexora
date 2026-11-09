# KNOWN_ISSUES

| ID | Severity | Issue | Mitigation / plan |
|---|---|---|---|
| KI-001 | Critical | Next.js 14.2.35 security advisories (`npm audit`) | Controlled upgrade; do not `audit fix --force` blindly |
| KI-002 | Critical | Demo mode can activate when Supabase env missing | **Fixed** — explicit opt-in + `ALLOW_DEMO_IN_PRODUCTION` |
| KI-011 | Critical | Signup metadata privilege escalation | **Fixed** in `20251109250000_security_hardening.sql` (apply to Supabase) |
| KI-012 | High | Auth callback open redirect | **Fixed** in app (`safeInternalPath`) |
| KI-003 | High | No automated tenant-isolation tests | Add suite + live Supabase |
| KI-004 | High | Ops modules demo-only actions | Wire Supabase parity |
| KI-005 | High | Float money rounding | Integer cents migration |
| KI-006 | High | Live demo exposed on HTTP :3000 | TLS reverse proxy |
| KI-007 | Medium | Dual project UIs | Consolidate to `/employer/projects` |
| KI-008 | Medium | English strings in shell | NL pass |
| KI-009 | Medium | Signature stored as data URL in demo JSON | Object storage |
| KI-010 | Low | README still MVP-scoped | Align with master docs |
