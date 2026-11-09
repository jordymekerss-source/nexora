-- Run AFTER applying migrations on a disposable Supabase/Postgres.
-- This file documents expected outcomes; execute manually with service role + anon tests.

-- Expectation matrix (application/trigger contract):
-- 1) Public signup metadata role=super_admin => profile.role=employee, tenant_id NULL
-- 2) Public signup metadata role=employer + tenant_id=<existing> => employee, NULL
-- 3) Public signup metadata role=employee + tenant_id=<existing> without invite => employee, NULL
-- 4) Normal signup (no privileged metadata) => employee, NULL; then create-organization elevates via service role
-- 5) Admin invite inserts tenant_invites; invited user consumes invite => employee + that tenant_id

-- Example verification queries after simulated signups:
-- select id, role, tenant_id from public.profiles order by created_at desc limit 20;
-- select * from public.tenant_invites order by created_at desc limit 20;
