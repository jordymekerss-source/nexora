-- Atomic billing helpers for quote→project→invoice conversion

create or replace function public.convert_quote_to_project_invoice(p_quote_id uuid)
returns table (project_id uuid, invoice_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_quote public.quotes%rowtype;
  v_project_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_due date := (current_date + 30);
begin
  if v_tenant is null or not public.is_employer() then
    raise exception 'not authorized';
  end if;

  select * into v_quote
  from public.quotes
  where id = p_quote_id and tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'quote not found';
  end if;

  insert into public.projects (tenant_id, title, client_name, address, status)
  values (
    v_tenant,
    v_quote.quote_number || ' — ' || v_quote.client_name,
    v_quote.client_name,
    'Offerte ' || v_quote.quote_number,
    'active'
  )
  returning id into v_project_id;

  update public.quotes
  set status = 'accepted'
  where id = v_quote.id;

  v_invoice_number := public.next_document_number(v_tenant, 'FAC');

  insert into public.invoices (
    tenant_id, invoice_number, project_id, quote_id, client_id, client_name,
    status, subtotal, vat_amount, total_amount, due_date
  )
  values (
    v_tenant, v_invoice_number, v_project_id, v_quote.id, v_quote.client_id, v_quote.client_name,
    'draft', v_quote.subtotal, v_quote.vat_amount, v_quote.total_amount, v_due
  )
  returning id into v_invoice_id;

  insert into public.invoice_items (invoice_id, description, quantity, unit_price, total_price)
  select v_invoice_id, qi.description, qi.quantity, qi.unit_price, qi.total_price
  from public.quote_items as qi
  where qi.quote_id = v_quote.id;

  project_id := v_project_id;
  invoice_id := v_invoice_id;
  return next;
end;
$$;

revoke all on function public.convert_quote_to_project_invoice(uuid) from public;
grant execute on function public.convert_quote_to_project_invoice(uuid) to authenticated;

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

  v_vat := round((v_subtotal * 0.21)::numeric, 2);
  v_total := v_subtotal + v_vat;
  v_quote_number := public.next_document_number(v_tenant, 'OFF');

  insert into public.quotes (
    tenant_id, quote_number, client_id, client_name, status,
    subtotal, vat_amount, total_amount, valid_until
  )
  values (
    v_tenant, v_quote_number, v_client.id, v_client.company_name, p_status,
    v_subtotal, v_vat, v_total, p_valid_until
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

revoke all on function public.create_quote_with_items(uuid, text, date, jsonb) from public;
grant execute on function public.create_quote_with_items(uuid, text, date, jsonb) to authenticated;
