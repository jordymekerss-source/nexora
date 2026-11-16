-- Live Supabase regression checklist (run manually after applying migrations).
-- Not executed in this worker without a project. Expected outcomes documented.

-- 1) Signup metadata escalation must NOT grant privileges
-- Attempt via GoTrue signUp with data: { role: 'super_admin', tenant_id: '<uuid>' }
-- Expect: profiles.role = 'employee', profiles.tenant_id IS NULL

-- 2) Employer metadata on signup ignored
-- data: { role: 'employer' }
-- Expect: profiles.role = 'employee'

-- 3) Arbitrary tenant_id ignored without tenant_invites row
-- Expect: tenant_id IS NULL

-- 4) Employee cannot update approved time entry
-- SET ROLE authenticated; SET request.jwt.claim.sub = '<employee_uid>';
-- UPDATE time_entries SET notes = 'hack' WHERE status = 'approved' AND user_id = '<employee_uid>';
-- Expect: 0 rows / policy deny

-- 5) Employee cannot set status away from pending
-- Expect: trigger/policy exception

-- 6) Employer cannot update approved row without correct_time_entry
-- UPDATE time_entries SET clock_out = now() WHERE status = 'approved';
-- Expect: deny unless nexora.allow_time_correction=on via RPC

-- 7) next_document_number rejects foreign tenant
-- SELECT next_document_number('<other_tenant>', 'FAC');
-- Expect: exception 'tenant mismatch'

-- 8) Cross-tenant client select
-- As tenant A JWT: SELECT * FROM clients WHERE tenant_id = '<tenant_b>';
-- Expect: 0 rows
