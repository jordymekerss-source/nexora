-- Core MVP stabilisation: atomic document numbers + tighter photo storage SELECT

-- ---------------------------------------------------------------------------
-- document_sequences: safe unique quote/invoice numbering under concurrency
-- ---------------------------------------------------------------------------
create table if not exists public.document_sequences (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  doc_prefix text not null check (doc_prefix in ('OFF', 'FAC')),
  year int not null check (year >= 2000 and year <= 2100),
  last_value int not null default 0 check (last_value >= 0),
  primary key (tenant_id, doc_prefix, year)
);

alter table public.document_sequences enable row level security;

drop policy if exists document_sequences_select on public.document_sequences;
create policy document_sequences_select on public.document_sequences
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_employer())
  );

-- Sequence allocation is service-role / security definer only (no direct client writes)
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
begin
  if p_prefix not in ('OFF', 'FAC') then
    raise exception 'invalid document prefix';
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
-- Storage: employees may only select their own uploaded objects under tenant folder
-- Path convention: {tenant_id}/{project_id}/{user_id}/...
-- ---------------------------------------------------------------------------
drop policy if exists project_photos_storage_select on storage.objects;
create policy project_photos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-photos'
    and (
      public.is_super_admin()
      or (
        public.is_employer()
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
      )
      or (
        public.is_employee()
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Role note: keep `employer` as company admin storage value for compatibility.
-- Optional future role `manager` prepared via check rewrite when needed.
-- ---------------------------------------------------------------------------
