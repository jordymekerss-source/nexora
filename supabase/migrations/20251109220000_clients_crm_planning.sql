-- NEXORA Module 2/3 alignment — Clients CRM, billing column shape, project schedules

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  company_name text not null,
  contact_person text,
  email text not null,
  phone text,
  address text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists clients_tenant_id_idx on public.clients (tenant_id);
create index if not exists clients_company_name_idx on public.clients (tenant_id, company_name);

-- ---------------------------------------------------------------------------
-- Align quotes with CRM schema (subtotal / vat_amount / total_amount)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quotes' and column_name = 'total_amount_excl_vat'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quotes' and column_name = 'subtotal'
  ) then
    alter table public.quotes rename column total_amount_excl_vat to subtotal;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quotes' and column_name = 'total_amount_incl_vat'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quotes' and column_name = 'total_amount'
  ) then
    alter table public.quotes rename column total_amount_incl_vat to total_amount;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quotes' and column_name = 'vat_amount'
  ) then
    alter table public.quotes add column vat_amount numeric(10, 2) not null default 0.00;
    update public.quotes
    set vat_amount = round(coalesce(total_amount, 0) - coalesce(subtotal, 0), 2)
    where vat_amount = 0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quotes' and column_name = 'client_email'
  ) then
    alter table public.quotes alter column client_email drop not null;
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'quotes'
      and constraint_name = 'quotes_client_id_fkey'
  ) then
    begin
      alter table public.quotes
        add constraint quotes_client_id_fkey
        foreign key (client_id) references public.clients (id) on delete set null;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Align invoices with CRM schema (client_id)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'client_id'
  ) then
    alter table public.invoices add column client_id uuid references public.clients (id) on delete set null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'client_email'
  ) then
    alter table public.invoices alter column client_email drop not null;
  end if;
end $$;

create index if not exists invoices_client_id_idx on public.invoices (client_id);

-- ---------------------------------------------------------------------------
-- project_schedules
-- ---------------------------------------------------------------------------
create table if not exists public.project_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  assigned_user_id uuid not null references public.profiles (id) on delete cascade,
  scheduled_date date not null,
  start_time time,
  end_time time,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists project_schedules_tenant_id_idx on public.project_schedules (tenant_id);
create index if not exists project_schedules_project_id_idx on public.project_schedules (project_id);
create index if not exists project_schedules_user_date_idx
  on public.project_schedules (assigned_user_id, scheduled_date);

-- ---------------------------------------------------------------------------
-- RLS: clients
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;

drop policy if exists clients_select on public.clients;
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists clients_delete on public.clients;

create policy clients_select on public.clients
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy clients_insert on public.clients
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy clients_update on public.clients
  for update to authenticated
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

create policy clients_delete on public.clients
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: project_schedules
-- ---------------------------------------------------------------------------
alter table public.project_schedules enable row level security;

drop policy if exists project_schedules_select on public.project_schedules;
drop policy if exists project_schedules_insert on public.project_schedules;
drop policy if exists project_schedules_update on public.project_schedules;
drop policy if exists project_schedules_delete on public.project_schedules;

create policy project_schedules_select on public.project_schedules
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
    or (
      public.is_employee()
      and assigned_user_id = auth.uid()
      and tenant_id = public.current_tenant_id()
    )
  );

create policy project_schedules_insert on public.project_schedules
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy project_schedules_update on public.project_schedules
  for update to authenticated
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

create policy project_schedules_delete on public.project_schedules
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );
