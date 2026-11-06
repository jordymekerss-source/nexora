-- NEXORA Module 2 — Quotes (Offertes) & Invoicing (Facturatie)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  quote_number text not null,
  client_id uuid,
  client_name text not null,
  client_email text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected')),
  total_amount_excl_vat numeric(10, 2) not null default 0.00,
  vat_percentage int not null default 21,
  total_amount_incl_vat numeric(10, 2) not null default 0.00,
  valid_until date,
  created_at timestamptz not null default now(),
  constraint quotes_tenant_number_unique unique (tenant_id, quote_number),
  constraint quotes_vat_percentage_check check (vat_percentage >= 0 and vat_percentage <= 100),
  constraint quotes_amounts_non_negative check (
    total_amount_excl_vat >= 0
    and total_amount_incl_vat >= 0
  )
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  description text not null,
  quantity numeric(10, 2) not null default 1.0,
  unit_price numeric(10, 2) not null default 0.00,
  total_price numeric(10, 2) not null default 0.00,
  constraint quote_items_quantity_positive check (quantity > 0),
  constraint quote_items_prices_non_negative check (
    unit_price >= 0
    and total_price >= 0
  )
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_number text not null,
  project_id uuid references public.projects (id) on delete set null,
  quote_id uuid references public.quotes (id) on delete set null,
  client_name text not null,
  client_email text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'overdue')),
  subtotal numeric(10, 2) not null default 0.00,
  vat_amount numeric(10, 2) not null default 0.00,
  total_amount numeric(10, 2) not null default 0.00,
  due_date date not null,
  created_at timestamptz not null default now(),
  constraint invoices_tenant_number_unique unique (tenant_id, invoice_number),
  constraint invoices_amounts_non_negative check (
    subtotal >= 0
    and vat_amount >= 0
    and total_amount >= 0
  )
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  description text not null,
  quantity numeric(10, 2) not null default 1.0,
  unit_price numeric(10, 2) not null default 0.00,
  total_price numeric(10, 2) not null default 0.00,
  constraint invoice_items_quantity_positive check (quantity > 0),
  constraint invoice_items_prices_non_negative check (
    unit_price >= 0
    and total_price >= 0
  )
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index quotes_tenant_id_idx on public.quotes (tenant_id);
create index quotes_status_idx on public.quotes (tenant_id, status);
create index quote_items_quote_id_idx on public.quote_items (quote_id);
create index invoices_tenant_id_idx on public.invoices (tenant_id);
create index invoices_status_idx on public.invoices (tenant_id, status);
create index invoices_project_id_idx on public.invoices (project_id);
create index invoices_quote_id_idx on public.invoices (quote_id);
create index invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

-- quotes: employer + super_admin only (employees have no access)
create policy quotes_select on public.quotes
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy quotes_insert on public.quotes
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy quotes_update on public.quotes
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

create policy quotes_delete on public.quotes
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- quote_items: access via parent quote tenant
create policy quote_items_select on public.quote_items
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.quotes as q
      where q.id = quote_items.quote_id
        and public.is_employer()
        and q.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  );

create policy quote_items_insert on public.quote_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or exists (
      select 1
      from public.quotes as q
      where q.id = quote_items.quote_id
        and public.is_employer()
        and q.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  );

create policy quote_items_update on public.quote_items
  for update to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.quotes as q
      where q.id = quote_items.quote_id
        and public.is_employer()
        and q.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  )
  with check (
    public.is_super_admin()
    or exists (
      select 1
      from public.quotes as q
      where q.id = quote_items.quote_id
        and public.is_employer()
        and q.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  );

create policy quote_items_delete on public.quote_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.quotes as q
      where q.id = quote_items.quote_id
        and public.is_employer()
        and q.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  );

-- invoices: employer + super_admin only
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy invoices_update on public.invoices
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

create policy invoices_delete on public.invoices
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- invoice_items: access via parent invoice tenant
create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.invoices as i
      where i.id = invoice_items.invoice_id
        and public.is_employer()
        and i.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  );

create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or exists (
      select 1
      from public.invoices as i
      where i.id = invoice_items.invoice_id
        and public.is_employer()
        and i.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  );

create policy invoice_items_update on public.invoice_items
  for update to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.invoices as i
      where i.id = invoice_items.invoice_id
        and public.is_employer()
        and i.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  )
  with check (
    public.is_super_admin()
    or exists (
      select 1
      from public.invoices as i
      where i.id = invoice_items.invoice_id
        and public.is_employer()
        and i.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  );

create policy invoice_items_delete on public.invoice_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.invoices as i
      where i.id = invoice_items.invoice_id
        and public.is_employer()
        and i.tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
    )
  );
