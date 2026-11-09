-- CRITICAL REPAIR P0
-- 1) Public signup never trusts role/tenant metadata
-- 2) Membership only via tenant_invites (Admin invite) or onboarding upgrade
-- 3) Re-affirm time_entries employee update requires pending on USING + WITH CHECK
-- 4) Additional cross-tenant integrity for invoices/quotes project links

-- ---------------------------------------------------------------------------
-- tenant_invites: authoritative invite ledger (not client metadata)
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  full_name text not null,
  invited_by uuid not null references public.profiles (id) on delete restrict,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_invites_email_lower check (email = lower(email))
);

create unique index if not exists tenant_invites_open_email_uidx
  on public.tenant_invites (tenant_id, email)
  where consumed_at is null;

create index if not exists tenant_invites_email_idx on public.tenant_invites (email);

alter table public.tenant_invites enable row level security;

drop policy if exists tenant_invites_select on public.tenant_invites;
create policy tenant_invites_select on public.tenant_invites
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

drop policy if exists tenant_invites_insert on public.tenant_invites;
create policy tenant_invites_insert on public.tenant_invites
  for insert to authenticated
  with check (
    public.is_employer()
    and tenant_id = public.current_tenant_id()
    and public.current_tenant_id() is not null
    and invited_by = auth.uid()
  );

-- Updates/consumes happen via security definer trigger / service role

-- ---------------------------------------------------------------------------
-- handle_new_user: ignore privileged metadata completely
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_tenant_id uuid;
  v_invite_id uuid;
  v_email text;
begin
  v_full_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  if v_full_name is null then
    v_full_name := coalesce(split_part(new.email, '@', 1), 'User');
  end if;

  v_email := lower(coalesce(new.email, ''));
  v_tenant_id := null;

  -- ONLY invited users may receive a tenant membership, and ONLY from tenant_invites.
  -- Never trust raw_user_meta_data.role or raw_user_meta_data.tenant_id.
  if new.invited_at is not null and v_email <> '' then
    select ti.id, ti.tenant_id
      into v_invite_id, v_tenant_id
    from public.tenant_invites as ti
    where ti.email = v_email
      and ti.consumed_at is null
    order by ti.created_at desc
    limit 1;

    if v_invite_id is not null then
      update public.tenant_invites
      set consumed_at = now()
      where id = v_invite_id;
    else
      v_tenant_id := null;
    end if;
  end if;

  insert into public.profiles (id, tenant_id, full_name, role)
  values (
    new.id,
    v_tenant_id,
    v_full_name,
    -- Public/bootstrap role is always employee. Employer is granted only by
    -- authorized onboarding (service role) after organization creation.
    -- Invited users remain employees of the inviting tenant.
    'employee'
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- time_entries_update: employee may only touch pending rows (USING + CHECK)
-- ---------------------------------------------------------------------------
drop policy if exists time_entries_update on public.time_entries;

create policy time_entries_update on public.time_entries
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
    or (
      public.is_employee()
      and user_id = auth.uid()
      and tenant_id = public.current_tenant_id()
      and status = 'pending'
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
    or (
      public.is_employee()
      and user_id = auth.uid()
      and tenant_id = public.current_tenant_id()
      and status = 'pending'
    )
  );

-- Prevent employees from changing status away from pending via sneaky updates
create or replace function public.enforce_time_entry_status_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_employee()
     and not public.is_employer()
     and not public.is_super_admin() then
    if old.status = 'approved' then
      raise exception 'Approved time entries cannot be modified by employees';
    end if;
    if new.status is distinct from 'pending' then
      raise exception 'Employees cannot change time entry status';
    end if;
    if new.user_id is distinct from old.user_id then
      raise exception 'Employees cannot reassign time entries';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Employees cannot change tenant_id';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_enforce_status_rules on public.time_entries;
create trigger time_entries_enforce_status_rules
  before update on public.time_entries
  for each row execute function public.enforce_time_entry_status_rules();

-- ---------------------------------------------------------------------------
-- Invoice/quote project/quote cross-tenant integrity
-- ---------------------------------------------------------------------------
create or replace function public.enforce_invoice_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients as c
    where c.id = new.client_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'invoices: client_id must belong to tenant_id';
  end if;

  if new.project_id is not null and not exists (
    select 1 from public.projects as p
    where p.id = new.project_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'invoices: project_id must belong to tenant_id';
  end if;

  if new.quote_id is not null and not exists (
    select 1 from public.quotes as q
    where q.id = new.quote_id and q.tenant_id = new.tenant_id
  ) then
    raise exception 'invoices: quote_id must belong to tenant_id';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_enforce_tenant_refs on public.invoices;
create trigger invoices_enforce_tenant_refs
  before insert or update on public.invoices
  for each row execute function public.enforce_invoice_tenant_refs();

create or replace function public.enforce_quote_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients as c
    where c.id = new.client_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'quotes: client_id must belong to tenant_id';
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_enforce_client_tenant on public.quotes;
drop trigger if exists quotes_enforce_tenant_refs on public.quotes;
create trigger quotes_enforce_tenant_refs
  before insert or update on public.quotes
  for each row execute function public.enforce_quote_tenant_refs();

-- Profiles cannot self-assign tenant_id / privileged role via direct update
create or replace function public.enforce_profile_privilege_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and auth.uid() = old.id then
    if new.role is distinct from old.role then
      raise exception 'Users cannot change their own role';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Users cannot change their own tenant_id';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_privilege_rules on public.profiles;
create trigger profiles_enforce_privilege_rules
  before update on public.profiles
  for each row execute function public.enforce_profile_privilege_rules();
