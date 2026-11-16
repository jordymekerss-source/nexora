# DEPLOYMENT CHECKLIST

## Before production traffic

- [ ] Apply **all** migrations through `20251111220000_p0_numbering_permissions.sql` on Supabase
- [ ] Run `supabase/tests/p0_security_regression.sql` scenarios (or equivalent PostgREST tests)
- [ ] `NEXT_PUBLIC_DEMO_MODE` must be `false` (or unset)
- [ ] `ALLOW_DEMO_IN_PRODUCTION` must be unset/false
- [ ] `NEXT_PUBLIC_SUPABASE_URL` + anon key set
- [ ] `SUPABASE_SERVICE_ROLE_KEY` only on server
- [ ] HTTPS termination in front of the app
- [ ] Confirm no service-role key in client bundles
- [ ] `npm run typecheck && npm test && npm run build`
- [ ] `npm run test:e2e` against a staging demo or ephemeral env
- [ ] Decide Next.js upgrade for security advisories
- [ ] Backups + restore drill documented
- [ ] Storage buckets private (`project-photos`, `documents`)

## After deploy

- [ ] Health check `/api/health`
- [ ] Signup → create organization → invite employee smoke test
- [ ] Tenant A cannot read Tenant B (manual or automated)
- [ ] Monitor auth errors / RLS denials
