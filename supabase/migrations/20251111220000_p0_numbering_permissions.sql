-- P0 follow-up: lock document numbering to caller tenant + Layer 3/4 permission foundation
-- Additive only.

-- ---------------------------------------------------------------------------
-- next_document_number: never allocate sequences for another tenant
-- ---------------------------------------------------------------------------
create or replace function public.next_document_number(
  p_tenant_id uuid,
  p_prefix text,
  p_year int default extract(year from now())::int
)
returns text
language plpgsql
security definer
set search_path = public
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
    if p_tenant_id is distinct from v_caller_tenant and not public.is_super_admin() then
      raise exception 'tenant mismatch for document numbering';
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

-- ---------------------------------------------------------------------------
-- Layer 3 — individual action permissions (opt-in overrides; role defaults remain)
-- ---------------------------------------------------------------------------
create table if not exists public.user_action_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  module_key text not null,
  can_view boolean not null default true,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_approve boolean not null default false,
  can_export boolean not null default false,
  can_manage boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint user_action_permissions_unique unique (tenant_id, user_id, module_key)
);

create index if not exists user_action_permissions_user_idx
  on public.user_action_permissions (tenant_id, user_id);

alter table public.user_action_permissions enable row level security;

drop policy if exists user_action_permissions_select on public.user_action_permissions;
create policy user_action_permissions_select on public.user_action_permissions
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
      and (public.is_employer() or user_id = auth.uid())
    )
  );

drop policy if exists user_action_permissions_write on public.user_action_permissions;
create policy user_action_permissions_write on public.user_action_permissions
  for all to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Layer 4 — data-level scopes (projects, clients, folders, documents, …)
-- ---------------------------------------------------------------------------
create table if not exists public.user_data_scopes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope_type text not null
    check (scope_type in (
      'project', 'client', 'folder', 'document', 'time', 'finance', 'hr', 'all_projects', 'all_clients'
    )),
  scope_id uuid,
  access_level text not null default 'read'
    check (access_level in ('read', 'write', 'approve', 'manage', 'none')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint user_data_scopes_unique unique (tenant_id, user_id, scope_type, scope_id)
);

create index if not exists user_data_scopes_user_idx
  on public.user_data_scopes (tenant_id, user_id);

alter table public.user_data_scopes enable row level security;

drop policy if exists user_data_scopes_select on public.user_data_scopes;
create policy user_data_scopes_select on public.user_data_scopes
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
      and (public.is_employer() or user_id = auth.uid())
    )
  );

drop policy if exists user_data_scopes_write on public.user_data_scopes;
create policy user_data_scopes_write on public.user_data_scopes
  for all to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- Integrity: scoped user must belong to same tenant
create or replace function public.enforce_permission_tenant_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
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

drop trigger if exists trg_user_action_permissions_tenant on public.user_action_permissions;
create trigger trg_user_action_permissions_tenant
  before insert or update on public.user_action_permissions
  for each row execute function public.enforce_permission_tenant_integrity();

drop trigger if exists trg_user_data_scopes_tenant on public.user_data_scopes;
create trigger trg_user_data_scopes_tenant
  before insert or update on public.user_data_scopes
  for each row execute function public.enforce_permission_tenant_integrity();
