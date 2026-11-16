-- Ultimate Product V2 — authz hardening
-- Additive: support grants, entitlement init flag, scope integrity, SECURITY DEFINER search_path.

-- ---------------------------------------------------------------------------
-- Tenant entitlement initialization (disambiguates empty vs uninitialized)
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists entitlements_initialized boolean not null default false;

-- ---------------------------------------------------------------------------
-- Temporary Super Admin support access (no silent unlimited tenant data)
-- ---------------------------------------------------------------------------
create table if not exists public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  grantee_user_id uuid not null references public.profiles (id) on delete cascade,
  approved_by uuid references public.profiles (id) on delete set null,
  reason text not null check (char_length(trim(reason)) >= 8),
  scopes text[] not null default array['*']::text[],
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint support_access_grants_window check (ends_at > starts_at)
);

create index if not exists support_access_grants_active_idx
  on public.support_access_grants (tenant_id, grantee_user_id)
  where revoked_at is null;

alter table public.support_access_grants enable row level security;

drop policy if exists support_access_grants_select on public.support_access_grants;
create policy support_access_grants_select on public.support_access_grants
  for select to authenticated
  using (
    grantee_user_id = auth.uid()
    or public.is_super_admin()
  );

drop policy if exists support_access_grants_write on public.support_access_grants;
-- Writes only via service role / future admin RPC (no broad authenticated insert).
create policy support_access_grants_write on public.support_access_grants
  for all to service_role
  using (true)
  with check (true);

create or replace function public.has_active_support_grant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.support_access_grants g
    where g.tenant_id = p_tenant_id
      and g.grantee_user_id = auth.uid()
      and g.revoked_at is null
      and g.starts_at <= now()
      and g.ends_at >= now()
  );
$$;

revoke all on function public.has_active_support_grant(uuid) from public;
grant execute on function public.has_active_support_grant(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Data scope integrity: null scope_id must not mean "all resources"
-- ---------------------------------------------------------------------------
alter table public.user_data_scopes
  drop constraint if exists user_data_scopes_scope_id_rules;

alter table public.user_data_scopes
  add constraint user_data_scopes_scope_id_rules check (
    (
      scope_type in ('all_projects', 'all_clients')
      and scope_id is null
    )
    or (
      scope_type not in ('all_projects', 'all_clients')
      and scope_id is not null
    )
  );

-- PostgreSQL UNIQUE allows multiple NULLs; use coalesced unique index.
alter table public.user_data_scopes
  drop constraint if exists user_data_scopes_unique;

drop index if exists user_data_scopes_unique_idx;
create unique index user_data_scopes_unique_idx
  on public.user_data_scopes (
    tenant_id,
    user_id,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- next_document_number: remove bare super_admin cross-tenant bypass
-- ---------------------------------------------------------------------------
create or replace function public.next_document_number(
  p_tenant_id uuid,
  p_prefix text,
  p_year int default extract(year from now())::int
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_next int;
  v_caller_tenant uuid := public.current_tenant_id();
  v_is_service boolean := coalesce(auth.role() = 'service_role', false);
begin
  if p_prefix not in ('OFF', 'FAC') then
    raise exception 'invalid document prefix';
  end if;

  if not v_is_service then
    if v_caller_tenant is null then
      raise exception 'not authorized';
    end if;
    if p_tenant_id is distinct from v_caller_tenant then
      if not (public.is_super_admin() and public.has_active_support_grant(p_tenant_id)) then
        raise exception 'tenant mismatch for document numbering';
      end if;
    end if;
  end if;

  insert into public.document_sequences as ds (tenant_id, doc_prefix, year, last_value)
  values (p_tenant_id, p_prefix, p_year, 1)
  on conflict (tenant_id, doc_prefix, year)
  do update set last_value = ds.last_value + 1
  returning last_value into v_next;

  return p_prefix || '-' || p_year::text || '-' || lpad(v_next::text, 3, '0');
end;
$$;

revoke all on function public.next_document_number(uuid, text, int) from public;
grant execute on function public.next_document_number(uuid, text, int) to authenticated, service_role;

-- Harden permission integrity trigger search_path
create or replace function public.enforce_permission_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'permission user must belong to tenant';
  end if;
  return new;
end;
$$;
