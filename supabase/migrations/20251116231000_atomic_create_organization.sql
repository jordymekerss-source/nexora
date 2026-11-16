-- Atomic organization onboarding (idempotent per user via advisory lock + null-tenant check)

create or replace function public.create_organization_for_caller(
  p_organization_name text,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_tenant_id uuid;
  v_name text := nullif(trim(p_organization_name), '');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'invalid organization name';
  end if;

  -- Serialize concurrent create attempts for the same user.
  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile missing';
  end if;
  if v_profile.role = 'super_admin' then
    raise exception 'super admin cannot create tenant via this path';
  end if;
  if v_profile.tenant_id is not null then
    return v_profile.tenant_id;
  end if;

  insert into public.tenants (name, entitlements_initialized)
  values (v_name, false)
  returning id into v_tenant_id;

  update public.profiles
  set tenant_id = v_tenant_id,
      role = 'employer'
  where id = v_uid
    and tenant_id is null;

  if not found then
    raise exception 'profile already attached';
  end if;

  insert into public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    v_tenant_id,
    v_uid,
    'organization.created',
    'tenant',
    v_tenant_id,
    jsonb_build_object(
      'organization_name', v_name,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_tenant_id;
end;
$$;

revoke all on function public.create_organization_for_caller(text, text) from public;
grant execute on function public.create_organization_for_caller(text, text) to authenticated;
