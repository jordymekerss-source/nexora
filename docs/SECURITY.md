# SECURITY

## Current controls

- Supabase Auth sessions via `@supabase/ssr`
- Server-side role checks in actions/layouts
- PostgreSQL RLS policies in migrations
- Service role key server-only for invites
- TypeScript strict mode

## Known gaps (see AUDIT_REPORT)

- Demo mode auth bypass (must be production-blocked)
- Next.js advisories on 14.2.35
- No rate limiting, MFA, support-access workflow, audit_events
- HTTP exposure of demo host
- Float money

## Production checklist (must all be true)

- [ ] `NEXT_PUBLIC_DEMO_MODE=false`
- [ ] Supabase URL/anon/service role set
- [ ] Migrations applied
- [ ] HTTPS termination
- [ ] Backups verified
- [ ] `npm audit` critical/high addressed or risk-accepted in writing
- [ ] Tenant isolation tests green against live DB
