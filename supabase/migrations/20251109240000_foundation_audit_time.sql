-- Phase 1 foundation: audit events, break entries, time corrections, module configs

-- ---------------------------------------------------------------------------
-- audit_events (append-oriented platform/tenant audit trail)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_tenant_id_idx on public.audit_events (tenant_id);
create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id);

alter table public.audit_events enable row level security;

create policy audit_events_select on public.audit_events
  for select using (
    public.is_super_admin()
    or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.is_employer())
    or (actor_user_id = auth.uid())
  );

create policy audit_events_insert on public.audit_events
  for insert with check (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and actor_user_id = auth.uid()
    )
  );

-- No update/delete policies: append-oriented (service role may maintain)

-- ---------------------------------------------------------------------------
-- break_entries (real breaks; not fictional deduction-only)
-- ---------------------------------------------------------------------------
create table if not exists public.break_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  time_entry_id uuid not null references public.time_entries (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  break_start timestamptz not null,
  break_end timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  constraint break_entries_range_check check (break_end is null or break_end >= break_start)
);

create index if not exists break_entries_tenant_id_idx on public.break_entries (tenant_id);
create index if not exists break_entries_time_entry_id_idx on public.break_entries (time_entry_id);
create index if not exists break_entries_user_id_idx on public.break_entries (user_id);

alter table public.break_entries enable row level security;

create policy break_entries_select on public.break_entries
  for select using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_employer())
    or (user_id = auth.uid() and tenant_id = public.current_tenant_id())
  );

create policy break_entries_insert on public.break_entries
  for insert with check (
    tenant_id = public.current_tenant_id()
    and (
      public.is_employer()
      or user_id = auth.uid()
    )
  );

create policy break_entries_update on public.break_entries
  for update using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_employer()
      or (user_id = auth.uid())
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and (
      public.is_employer()
      or user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- time_entry_corrections (append-only correction ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.time_entry_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  time_entry_id uuid not null references public.time_entries (id) on delete cascade,
  corrected_by uuid not null references public.profiles (id) on delete restrict,
  reason text not null,
  old_clock_in timestamptz not null,
  old_clock_out timestamptz,
  old_break_minutes int not null,
  new_clock_in timestamptz not null,
  new_clock_out timestamptz,
  new_break_minutes int not null,
  created_at timestamptz not null default now()
);

create index if not exists time_entry_corrections_tenant_id_idx on public.time_entry_corrections (tenant_id);
create index if not exists time_entry_corrections_time_entry_id_idx on public.time_entry_corrections (time_entry_id);

alter table public.time_entry_corrections enable row level security;

create policy time_entry_corrections_select on public.time_entry_corrections
  for select using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_employer())
  );

create policy time_entry_corrections_insert on public.time_entry_corrections
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.is_employer()
    and corrected_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- module_configs (per-tenant module activation)
-- ---------------------------------------------------------------------------
create table if not exists public.module_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  module_key text not null,
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint module_configs_tenant_module_unique unique (tenant_id, module_key)
);

create index if not exists module_configs_tenant_id_idx on public.module_configs (tenant_id);

alter table public.module_configs enable row level security;

create policy module_configs_select on public.module_configs
  for select using (
    public.is_super_admin()
    or tenant_id = public.current_tenant_id()
  );

create policy module_configs_insert on public.module_configs
  for insert with check (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_employer())
  );

create policy module_configs_update on public.module_configs
  for update using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_employer())
  )
  with check (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_employer())
  );
