-- Audit follow-up: approved time corrections + atomic invoice-from-hours + VAT rate history
-- Additive only. Does not rewrite prior migrations.

-- ---------------------------------------------------------------------------
-- Historical VAT rate on commercial documents (basis points; 2100 = 21.00%)
-- ---------------------------------------------------------------------------
alter table public.quotes
  add column if not exists vat_rate_bps integer not null default 2100
  check (vat_rate_bps >= 0 and vat_rate_bps <= 10000);

alter table public.invoices
  add column if not exists vat_rate_bps integer not null default 2100
  check (vat_rate_bps >= 0 and vat_rate_bps <= 10000);

-- ---------------------------------------------------------------------------
-- Billing idempotency ledger
-- ---------------------------------------------------------------------------
create table if not exists public.billing_idempotency (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  idempotency_key text not null,
  operation text not null,
  result_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key)
);

alter table public.billing_idempotency enable row level security;

drop policy if exists billing_idempotency_select on public.billing_idempotency;
create policy billing_idempotency_select on public.billing_idempotency
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Employer may not freely update approved time entries (must use correction RPC)
-- Approve pending→approved still allowed (USING sees pending).
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
      and (
        status = 'pending'
        or current_setting('nexora.allow_time_correction', true) = 'on'
      )
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
      and status in ('pending', 'approved')
    )
    or (
      public.is_employee()
      and user_id = auth.uid()
      and tenant_id = public.current_tenant_id()
      and status = 'pending'
    )
  );

create or replace function public.correct_time_entry(
  p_entry_id uuid,
  p_reason text,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_break_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_entry public.time_entries%rowtype;
  v_correction_id uuid;
begin
  if v_tenant is null or not public.is_employer() then
    raise exception 'not authorized';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason required';
  end if;
  if p_break_minutes is null or p_break_minutes < 0 then
    raise exception 'invalid break minutes';
  end if;
  if p_clock_out is not null and p_clock_out < p_clock_in then
    raise exception 'clock_out before clock_in';
  end if;

  select * into v_entry
  from public.time_entries
  where id = p_entry_id and tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'time entry not found';
  end if;

  perform set_config('nexora.allow_time_correction', 'on', true);

  insert into public.time_entry_corrections (
    tenant_id, time_entry_id, corrected_by, reason,
    old_clock_in, old_clock_out, old_break_minutes,
    new_clock_in, new_clock_out, new_break_minutes
  )
  values (
    v_tenant, v_entry.id, auth.uid(), trim(p_reason),
    v_entry.clock_in, v_entry.clock_out, v_entry.break_minutes,
    p_clock_in, p_clock_out, p_break_minutes
  )
  returning id into v_correction_id;

  update public.time_entries
  set
    clock_in = p_clock_in,
    clock_out = p_clock_out,
    break_minutes = p_break_minutes
  where id = v_entry.id;

  insert into public.audit_events (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  )
  values (
    v_tenant,
    auth.uid(),
    'timesheet.corrected',
    'time_entry',
    v_entry.id,
    jsonb_build_object('correction_id', v_correction_id, 'reason', trim(p_reason))
  );

  return v_correction_id;
end;
$$;

revoke all on function public.correct_time_entry(uuid, text, timestamptz, timestamptz, integer) from public;
grant execute on function public.correct_time_entry(uuid, text, timestamptz, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic invoice from approved project hours
-- ---------------------------------------------------------------------------
create or replace function public.create_invoice_from_approved_time(
  p_project_id uuid,
  p_hourly_rate numeric,
  p_vat_rate_bps integer default 2100,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_project public.projects%rowtype;
  v_minutes numeric := 0;
  v_hours numeric(12,4);
  v_line numeric(12,2);
  v_vat numeric(12,2);
  v_total numeric(12,2);
  v_invoice_id uuid;
  v_invoice_number text;
  v_due date := (current_date + 30);
  v_rate_bps integer := coalesce(p_vat_rate_bps, 2100);
  v_existing uuid;
begin
  if v_tenant is null or not public.is_employer() then
    raise exception 'not authorized';
  end if;
  if p_hourly_rate is null or p_hourly_rate < 0 then
    raise exception 'invalid hourly rate';
  end if;
  if v_rate_bps < 0 or v_rate_bps > 10000 then
    raise exception 'invalid vat rate';
  end if;

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    select result_id into v_existing
    from public.billing_idempotency
    where tenant_id = v_tenant and idempotency_key = trim(p_idempotency_key);
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id and tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'project not found';
  end if;

  select coalesce(sum(
    greatest(
      0,
      extract(epoch from (coalesce(te.clock_out, now()) - te.clock_in)) / 60.0 - te.break_minutes
    )
  ), 0)
  into v_minutes
  from public.time_entries as te
  where te.project_id = v_project.id
    and te.tenant_id = v_tenant
    and te.status = 'approved'
    and te.clock_out is not null;

  v_hours := round((v_minutes / 60.0)::numeric, 4);
  if v_hours <= 0 then
    raise exception 'no approved billable hours';
  end if;

  v_line := round((v_hours * p_hourly_rate)::numeric, 2);
  v_vat := round((v_line * (v_rate_bps::numeric / 10000.0))::numeric, 2);
  v_total := v_line + v_vat;

  v_invoice_number := public.next_document_number(v_tenant, 'FAC');

  insert into public.invoices (
    tenant_id, invoice_number, project_id, quote_id, client_id, client_name,
    status, subtotal, vat_amount, total_amount, due_date, vat_rate_bps
  )
  values (
    v_tenant, v_invoice_number, v_project.id, null, null,
    coalesce(v_project.client_name, 'Klant'),
    'draft', v_line, v_vat, v_total, v_due, v_rate_bps
  )
  returning id into v_invoice_id;

  insert into public.invoice_items (invoice_id, description, quantity, unit_price, total_price)
  values (
    v_invoice_id,
    'Goedgekeurde uren — ' || v_project.title,
    v_hours,
    p_hourly_rate,
    v_line
  );

  if p_idempotency_key is not null and length(trim(p_idempotency_key)) > 0 then
    insert into public.billing_idempotency (tenant_id, idempotency_key, operation, result_id)
    values (v_tenant, trim(p_idempotency_key), 'invoice_from_approved_time', v_invoice_id)
    on conflict (tenant_id, idempotency_key) do nothing;
  end if;

  return v_invoice_id;
end;
$$;

revoke all on function public.create_invoice_from_approved_time(uuid, numeric, integer, text) from public;
grant execute on function public.create_invoice_from_approved_time(uuid, numeric, integer, text) to authenticated;

-- Persist VAT rate on quote RPC
create or replace function public.create_quote_with_items(
  p_client_id uuid,
  p_status text,
  p_valid_until date,
  p_items jsonb,
  p_vat_rate_bps integer default 2100
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_client public.clients%rowtype;
  v_quote_id uuid;
  v_quote_number text;
  v_subtotal numeric(10,2) := 0;
  v_vat numeric(10,2);
  v_total numeric(10,2);
  v_item jsonb;
  v_line numeric(10,2);
  v_rate_bps integer := coalesce(p_vat_rate_bps, 2100);
begin
  if v_tenant is null or not public.is_employer() then
    raise exception 'not authorized';
  end if;
  if p_status not in ('draft', 'sent') then
    raise exception 'invalid status';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items required';
  end if;
  if v_rate_bps < 0 or v_rate_bps > 10000 then
    raise exception 'invalid vat rate';
  end if;

  select * into v_client
  from public.clients
  where id = p_client_id and tenant_id = v_tenant;
  if not found then
    raise exception 'client not found';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_line := round(((v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric)::numeric, 2);
    v_subtotal := v_subtotal + v_line;
  end loop;

  v_vat := round((v_subtotal * (v_rate_bps::numeric / 10000.0))::numeric, 2);
  v_total := v_subtotal + v_vat;
  v_quote_number := public.next_document_number(v_tenant, 'OFF');

  insert into public.quotes (
    tenant_id, quote_number, client_id, client_name, status,
    subtotal, vat_amount, total_amount, valid_until, vat_rate_bps
  )
  values (
    v_tenant, v_quote_number, v_client.id, v_client.company_name, p_status,
    v_subtotal, v_vat, v_total, p_valid_until, v_rate_bps
  )
  returning id into v_quote_id;

  insert into public.quote_items (quote_id, description, quantity, unit_price, total_price)
  select
    v_quote_id,
    item->>'description',
    (item->>'quantity')::numeric,
    (item->>'unit_price')::numeric,
    round(((item->>'quantity')::numeric * (item->>'unit_price')::numeric)::numeric, 2)
  from jsonb_array_elements(p_items) as item;

  return v_quote_id;
end;
$$;

revoke all on function public.create_quote_with_items(uuid, text, date, jsonb, integer) from public;
grant execute on function public.create_quote_with_items(uuid, text, date, jsonb, integer) to authenticated;

-- Keep 4-arg overload for older callers by wrapping
create or replace function public.create_quote_with_items(
  p_client_id uuid,
  p_status text,
  p_valid_until date,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_quote_with_items(p_client_id, p_status, p_valid_until, p_items, 2100);
end;
$$;

revoke all on function public.create_quote_with_items(uuid, text, date, jsonb) from public;
grant execute on function public.create_quote_with_items(uuid, text, date, jsonb) to authenticated;
