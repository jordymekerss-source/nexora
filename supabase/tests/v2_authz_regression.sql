-- V2 authz regression checks (run against an isolated Supabase/Postgres test DB).
-- Do not mark VERIFIED without executing this file against a real database.

-- 1) scope_id null forbidden for concrete types
do $$
begin
  begin
    insert into public.user_data_scopes (tenant_id, user_id, scope_type, scope_id, access_level)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'project', null, 'read');
    raise exception 'expected concrete scope_id null to fail';
  exception when check_violation then
    null;
  end;
end $$;

-- 2) all_projects requires null scope_id
do $$
begin
  begin
    insert into public.user_data_scopes (tenant_id, user_id, scope_type, scope_id, access_level)
    values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'all_projects',
      '00000000-0000-0000-0000-000000000099',
      'read'
    );
    raise exception 'expected all_projects with scope_id to fail';
  exception when check_violation then
    null;
  end;
end $$;

-- 3) support grant helper exists
select to_regprocedure('public.has_active_support_grant(uuid)') is not null as support_fn_ok;
