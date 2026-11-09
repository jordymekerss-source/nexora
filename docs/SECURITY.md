# SECURITY

## Current controls

- Supabase Auth sessions via `@supabase/ssr`
- Server-side role checks in actions/layouts
- PostgreSQL RLS policies in migrations
- Service role key server-only for invites
- TypeScript strict mode

## Hardening applied (2026-11-09)

- Demo mode: explicit opt-in; production requires `ALLOW_DEMO_IN_PRODUCTION`
- `handle_new_user`: no self-serve `super_admin`; tenant attach only for Admin invites (`invited_at`)
- Auth callback: relative-path-only redirects (`safeInternalPath`)
- RLS: employees cannot edit approved time entries; employers cannot escalate peer roles
- Tenant integrity triggers on schedules, assignments, fleet, tools, certificates, work orders, quotes/invoices clients, break entries
- `audit_events` / break / correction / module_config tables (foundation migration)

## Remaining gaps

- Next.js advisories on 14.2.35 (upgrade decision)
- No rate limiting, MFA, support-access workflow UI
- HTTP exposure of demo host
- Billing still uses float euros (cents helper exists)
- Live RLS isolation suite not yet executed against Supabase

## Production checklist (must all be true)

- [ ] `NEXT_PUBLIC_DEMO_MODE=false`
- [ ] Supabase URL/anon/service role set
- [ ] Migrations applied
- [ ] HTTPS termination
- [ ] Backups verified
- [ ] `npm audit` critical/high addressed or risk-accepted in writing
- [ ] Tenant isolation tests green against live DB
