-- NEXORA Final ops modules: assignments, fleet, tools, HR certificates, work orders

-- ---------------------------------------------------------------------------
-- project_assignments (multi-user projects)
-- ---------------------------------------------------------------------------
create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  constraint project_assignments_unique unique (project_id, user_id)
);

create index if not exists project_assignments_tenant_id_idx on public.project_assignments (tenant_id);
create index if not exists project_assignments_user_id_idx on public.project_assignments (user_id);
create index if not exists project_assignments_project_id_idx on public.project_assignments (project_id);

-- Ensure time_entries can coexist for many users on one project/day
create index if not exists time_entries_project_user_clock_idx
  on public.time_entries (project_id, user_id, clock_in);

-- ---------------------------------------------------------------------------
-- vehicles (fleet)
-- ---------------------------------------------------------------------------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  license_plate text not null,
  brand_model text not null,
  apk_expiry_date date,
  km_status int not null default 0,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint vehicles_tenant_plate_unique unique (tenant_id, license_plate),
  constraint vehicles_km_non_negative check (km_status >= 0)
);

create index if not exists vehicles_tenant_id_idx on public.vehicles (tenant_id);

-- ---------------------------------------------------------------------------
-- tools
-- ---------------------------------------------------------------------------
create table if not exists public.tools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  serial_number text,
  status text not null default 'active' check (status in ('active', 'maintenance', 'broken')),
  checked_out_to_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists tools_tenant_id_idx on public.tools (tenant_id);

-- ---------------------------------------------------------------------------
-- employee_certificates
-- ---------------------------------------------------------------------------
create table if not exists public.employee_certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  certificate_name text not null,
  expiry_date date not null,
  document_url text,
  created_at timestamptz not null default now()
);

create index if not exists employee_certificates_tenant_id_idx on public.employee_certificates (tenant_id);
create index if not exists employee_certificates_user_id_idx on public.employee_certificates (user_id);
create index if not exists employee_certificates_expiry_idx on public.employee_certificates (expiry_date);

-- ---------------------------------------------------------------------------
-- work_orders
-- ---------------------------------------------------------------------------
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  client_signature_url text,
  work_summary text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists work_orders_tenant_id_idx on public.work_orders (tenant_id);
create index if not exists work_orders_project_id_idx on public.work_orders (project_id);

-- ---------------------------------------------------------------------------
-- RLS helpers reuse is_employer / is_employee / current_tenant_id / is_super_admin
-- ---------------------------------------------------------------------------
alter table public.project_assignments enable row level security;
alter table public.vehicles enable row level security;
alter table public.tools enable row level security;
alter table public.employee_certificates enable row level security;
alter table public.work_orders enable row level security;

-- project_assignments
drop policy if exists project_assignments_select on public.project_assignments;
drop policy if exists project_assignments_insert on public.project_assignments;
drop policy if exists project_assignments_update on public.project_assignments;
drop policy if exists project_assignments_delete on public.project_assignments;

create policy project_assignments_select on public.project_assignments
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
    )
    or (
      public.is_employee()
      and user_id = auth.uid()
      and tenant_id = public.current_tenant_id()
    )
  );

create policy project_assignments_insert on public.project_assignments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
    )
  );

create policy project_assignments_update on public.project_assignments
  for update to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  )
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

create policy project_assignments_delete on public.project_assignments
  for delete to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

-- vehicles: employer full; employee can select own assigned vehicle
drop policy if exists vehicles_select on public.vehicles;
drop policy if exists vehicles_write on public.vehicles;
drop policy if exists vehicles_update on public.vehicles;
drop policy if exists vehicles_delete on public.vehicles;

create policy vehicles_select on public.vehicles
  for select to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
    or (
      public.is_employee()
      and tenant_id = public.current_tenant_id()
      and assigned_user_id = auth.uid()
    )
  );

create policy vehicles_insert on public.vehicles
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

create policy vehicles_update on public.vehicles
  for update to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  )
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

create policy vehicles_delete on public.vehicles
  for delete to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

-- tools
create policy tools_select on public.tools
  for select to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
    or (
      public.is_employee()
      and tenant_id = public.current_tenant_id()
      and (
        checked_out_to_user_id = auth.uid()
        or checked_out_to_user_id is null
      )
    )
  );

create policy tools_insert on public.tools
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

create policy tools_update on public.tools
  for update to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  )
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

create policy tools_delete on public.tools
  for delete to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

-- employee_certificates
create policy employee_certificates_select on public.employee_certificates
  for select to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
    or (
      public.is_employee()
      and user_id = auth.uid()
      and tenant_id = public.current_tenant_id()
    )
  );

create policy employee_certificates_insert on public.employee_certificates
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

create policy employee_certificates_update on public.employee_certificates
  for update to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  )
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

create policy employee_certificates_delete on public.employee_certificates
  for delete to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );

-- work_orders: employer full; employee can insert/select for assigned projects
create policy work_orders_select on public.work_orders
  for select to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
    or (
      public.is_employee()
      and tenant_id = public.current_tenant_id()
      and exists (
        select 1
        from public.project_assignments as pa
        where pa.project_id = work_orders.project_id
          and pa.user_id = auth.uid()
      )
    )
  );

create policy work_orders_insert on public.work_orders
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
    or (
      public.is_employee()
      and tenant_id = public.current_tenant_id()
      and exists (
        select 1
        from public.project_assignments as pa
        where pa.project_id = work_orders.project_id
          and pa.user_id = auth.uid()
      )
    )
  );

create policy work_orders_update on public.work_orders
  for update to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
    or (
      public.is_employee()
      and tenant_id = public.current_tenant_id()
      and exists (
        select 1
        from public.project_assignments as pa
        where pa.project_id = work_orders.project_id
          and pa.user_id = auth.uid()
      )
    )
  )
  with check (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
    or (
      public.is_employee()
      and tenant_id = public.current_tenant_id()
      and exists (
        select 1
        from public.project_assignments as pa
        where pa.project_id = work_orders.project_id
          and pa.user_id = auth.uid()
      )
    )
  );

create policy work_orders_delete on public.work_orders
  for delete to authenticated
  using (
    public.is_super_admin()
    or (public.is_employer() and tenant_id = public.current_tenant_id())
  );
