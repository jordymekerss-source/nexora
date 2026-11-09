-- P0 security hardening from master audit
-- 1) Lock signup bootstrap (no self-serve super_admin / arbitrary tenant join)
-- 2) Tighten profiles + time_entries RLS
-- 3) Tenant integrity triggers for ops/CRM child tables

-- ---------------------------------------------------------------------------
-- handle_new_user: public signup may only create employer (no tenant) or employee
-- without a client-supplied tenant_id. Invites attach tenant via Admin API after
-- the profile exists, or via a separate trusted path — never from raw metadata
-- on open signup. super_admin is SQL/service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_role text;
  v_tenant_id uuid;
begin
  v_full_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  if v_full_name is null then
    v_full_name := coalesce(split_part(new.email, '@', 1), 'User');
  end if;

  -- Never accept super_admin from client/admin metadata on user create.
  v_role := coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'employee');
  if v_role not in ('employer', 'employee') then
    v_role := 'employee';
  end if;

  v_tenant_id := null;

  -- Tenant join only for Admin-invited employees (invited_at set by GoTrue invite).
  -- Public self-signup cannot attach an arbitrary tenant_id.
  if v_role = 'employee'
     and new.invited_at is not null
     and new.raw_user_meta_data ? 'tenant_id'
     and nullif(trim(new.raw_user_meta_data->>'tenant_id'), '') is not null then
    begin
      v_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;
    exception
      when invalid_text_representation then
        v_tenant_id := null;
    end;

    if v_tenant_id is not null and not exists (
      select 1 from public.tenants as t where t.id = v_tenant_id
    ) then
      v_tenant_id := null;
    end if;
  end if;

  insert into public.profiles (id, tenant_id, full_name, role)
  values (new.id, v_tenant_id, v_full_name, v_role);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: employers may only manage employees in their tenant; cannot escalate role
-- ---------------------------------------------------------------------------
drop policy if exists profiles_update_employer on public.profiles;

create policy profiles_update_employer on public.profiles
  for update to authenticated
  using (
    public.is_employer()
    and tenant_id is not distinct from public.current_tenant_id()
    and public.current_tenant_id() is not null
    and role = 'employee'
    and id <> auth.uid()
  )
  with check (
    public.is_employer()
    and tenant_id is not distinct from public.current_tenant_id()
    and public.current_tenant_id() is not null
    and role = 'employee'
  );

-- ---------------------------------------------------------------------------
-- time_entries: employees may only edit rows that are still pending
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

-- ---------------------------------------------------------------------------
-- Tenant-scoped FK integrity helpers + triggers
-- ---------------------------------------------------------------------------
create or replace function public.enforce_project_and_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.projects as p
    where p.id = new.project_id and p.tenant_id = new.tenant_id
  ) then
    raise exception '%: project_id must belong to tenant_id', tg_table_name;
  end if;

  if not exists (
    select 1 from public.profiles as pr
    where pr.id = new.user_id and pr.tenant_id = new.tenant_id
  ) then
    raise exception '%: user_id must belong to tenant_id', tg_table_name;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_project_and_optional_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.projects as p
    where p.id = new.project_id and p.tenant_id = new.tenant_id
  ) then
    raise exception '%: project_id must belong to tenant_id', tg_table_name;
  end if;

  if new.assigned_user_id is not null and not exists (
    select 1 from public.profiles as pr
    where pr.id = new.assigned_user_id and pr.tenant_id = new.tenant_id
  ) then
    raise exception '%: assigned_user_id must belong to tenant_id', tg_table_name;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_optional_assigned_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_user_id is not null and not exists (
    select 1 from public.profiles as pr
    where pr.id = new.assigned_user_id and pr.tenant_id = new.tenant_id
  ) then
    raise exception '%: assigned_user_id must belong to tenant_id', tg_table_name;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_optional_checkout_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.checked_out_to_user_id is not null and not exists (
    select 1 from public.profiles as pr
    where pr.id = new.checked_out_to_user_id and pr.tenant_id = new.tenant_id
  ) then
    raise exception '%: checked_out_to_user_id must belong to tenant_id', tg_table_name;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_certificate_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles as pr
    where pr.id = new.user_id and pr.tenant_id = new.tenant_id
  ) then
    raise exception 'employee_certificates: user_id must belong to tenant_id';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_work_order_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.projects as p
    where p.id = new.project_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'work_orders: project_id must belong to tenant_id';
  end if;

  if new.created_by is not null and not exists (
    select 1 from public.profiles as pr
    where pr.id = new.created_by and pr.tenant_id = new.tenant_id
  ) then
    raise exception 'work_orders: created_by must belong to tenant_id';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_client_optional_on_quote_invoice()
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
    raise exception '%: client_id must belong to tenant_id', tg_table_name;
  end if;
  return new;
end;
$$;

-- Drop/recreate triggers idempotently
drop trigger if exists project_assignments_enforce_tenant on public.project_assignments;
create trigger project_assignments_enforce_tenant
  before insert or update on public.project_assignments
  for each row execute function public.enforce_project_and_user_tenant();

drop trigger if exists project_schedules_enforce_tenant on public.project_schedules;
create trigger project_schedules_enforce_tenant
  before insert or update on public.project_schedules
  for each row execute function public.enforce_project_and_optional_user_tenant();

drop trigger if exists vehicles_enforce_tenant on public.vehicles;
create trigger vehicles_enforce_tenant
  before insert or update on public.vehicles
  for each row execute function public.enforce_optional_assigned_user_tenant();

drop trigger if exists tools_enforce_tenant on public.tools;
create trigger tools_enforce_tenant
  before insert or update on public.tools
  for each row execute function public.enforce_optional_checkout_user_tenant();

drop trigger if exists employee_certificates_enforce_tenant on public.employee_certificates;
create trigger employee_certificates_enforce_tenant
  before insert or update on public.employee_certificates
  for each row execute function public.enforce_certificate_user_tenant();

drop trigger if exists work_orders_enforce_tenant on public.work_orders;
create trigger work_orders_enforce_tenant
  before insert or update on public.work_orders
  for each row execute function public.enforce_work_order_tenant();

drop trigger if exists quotes_enforce_client_tenant on public.quotes;
create trigger quotes_enforce_client_tenant
  before insert or update on public.quotes
  for each row execute function public.enforce_client_optional_on_quote_invoice();

drop trigger if exists invoices_enforce_client_tenant on public.invoices;
create trigger invoices_enforce_client_tenant
  before insert or update on public.invoices
  for each row execute function public.enforce_client_optional_on_quote_invoice();

create or replace function public.enforce_break_entry_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.time_entries as te
    where te.id = new.time_entry_id and te.tenant_id = new.tenant_id
  ) then
    raise exception 'break_entries: time_entry_id must belong to tenant_id';
  end if;

  if not exists (
    select 1 from public.profiles as pr
    where pr.id = new.user_id and pr.tenant_id = new.tenant_id
  ) then
    raise exception 'break_entries: user_id must belong to tenant_id';
  end if;

  return new;
end;
$$;

drop trigger if exists break_entries_enforce_tenant on public.break_entries;
create trigger break_entries_enforce_tenant
  before insert or update on public.break_entries
  for each row execute function public.enforce_break_entry_tenant();
