-- Phase 1 foundation: DMS, storage quotas, domain outbox, accountant portal, periods
-- Does NOT implement full ERP modules. Live RLS proof still required after apply.

-- ---------------------------------------------------------------------------
-- Tenant storage quota overrides + subscription hints
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists storage_quota_bytes bigint,
  add column if not exists subscription_tier text not null default 'basic'
    check (subscription_tier in ('basic', 'professional', 'enterprise', 'custom'));

comment on column public.tenants.storage_quota_bytes is
  'NULL = use tier default; Super Admin may set per-tenant override.';

-- ---------------------------------------------------------------------------
-- Feature entitlements (fine-grained, beyond module_configs)
-- ---------------------------------------------------------------------------
create table if not exists public.feature_entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  trial_ends_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_entitlements_tenant_feature_uidx unique (tenant_id, feature_key)
);

create index if not exists feature_entitlements_tenant_idx
  on public.feature_entitlements (tenant_id);

alter table public.feature_entitlements enable row level security;

drop policy if exists feature_entitlements_select on public.feature_entitlements;
create policy feature_entitlements_select on public.feature_entitlements
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

drop policy if exists feature_entitlements_write_super on public.feature_entitlements;
create policy feature_entitlements_write_super on public.feature_entitlements
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Domain outbox (reliable cross-module events)
-- ---------------------------------------------------------------------------
create table if not exists public.domain_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  event_type text not null,
  event_version int not null default 1,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'failed', 'dead')),
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint domain_outbox_tenant_idempotency_uidx unique (tenant_id, idempotency_key)
);

create index if not exists domain_outbox_poll_idx
  on public.domain_outbox (status, available_at)
  where status in ('pending', 'failed');

alter table public.domain_outbox enable row level security;

drop policy if exists domain_outbox_select on public.domain_outbox;
create policy domain_outbox_select on public.domain_outbox
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- Inserts via security definer helpers / service role only (no client insert policy).

-- ---------------------------------------------------------------------------
-- Documents / DMS
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  module_key text not null,
  category text not null
    check (category in ('photo', 'document', 'spreadsheet', 'video', 'audio', 'zip', 'other')),
  title text not null,
  description text,
  entity_type text,
  entity_id uuid,
  current_version_id uuid,
  byte_size bigint not null default 0 check (byte_size >= 0),
  content_type text,
  soft_deleted_at timestamptz,
  purge_after timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_tenant_idx on public.documents (tenant_id);
create index if not exists documents_entity_idx
  on public.documents (tenant_id, entity_type, entity_id)
  where soft_deleted_at is null;
create index if not exists documents_module_idx on public.documents (tenant_id, module_key);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  version_number int not null check (version_number > 0),
  storage_bucket text not null default 'documents',
  storage_path text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text,
  original_filename text not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint document_versions_doc_version_uidx unique (document_id, version_number),
  constraint document_versions_path_uidx unique (storage_bucket, storage_path)
);

create index if not exists document_versions_tenant_idx
  on public.document_versions (tenant_id);

alter table public.documents
  drop constraint if exists documents_current_version_fk;
alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions (id)
  on delete set null;

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  module_key text not null,
  category text not null
    check (category in ('photo', 'document', 'spreadsheet', 'video', 'audio', 'zip', 'other')),
  declared_content_type text not null,
  declared_byte_size bigint not null check (declared_byte_size > 0),
  original_filename text not null,
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'verified', 'rejected', 'expired')),
  storage_path text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  completed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create index if not exists upload_sessions_tenant_idx on public.upload_sessions (tenant_id);
create index if not exists upload_sessions_status_idx
  on public.upload_sessions (tenant_id, status, expires_at);

create table if not exists public.storage_usage (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  photo_bytes bigint not null default 0 check (photo_bytes >= 0),
  document_bytes bigint not null default 0 check (document_bytes >= 0),
  spreadsheet_bytes bigint not null default 0 check (spreadsheet_bytes >= 0),
  video_bytes bigint not null default 0 check (video_bytes >= 0),
  audio_bytes bigint not null default 0 check (audio_bytes >= 0),
  zip_bytes bigint not null default 0 check (zip_bytes >= 0),
  other_bytes bigint not null default 0 check (other_bytes >= 0),
  updated_at timestamptz not null default now()
);

alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.storage_usage enable row level security;

drop policy if exists documents_tenant_all on public.documents;
create policy documents_tenant_all on public.documents
  for all to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
      and soft_deleted_at is null
    )
  )
  with check (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

drop policy if exists document_versions_tenant_all on public.document_versions;
create policy document_versions_tenant_all on public.document_versions
  for all to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  )
  with check (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

drop policy if exists upload_sessions_tenant_all on public.upload_sessions;
create policy upload_sessions_tenant_all on public.upload_sessions
  for all to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
      and (
        public.is_employer()
        or created_by = auth.uid()
      )
    )
  )
  with check (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
      and created_by = auth.uid()
    )
  );

drop policy if exists storage_usage_select on public.storage_usage;
create policy storage_usage_select on public.storage_usage
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- Storage bucket for private documents (apply via dashboard if create fails in SQL)
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 524288000)
on conflict (id) do update
set public = false,
    file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), 524288000);

drop policy if exists documents_storage_select on storage.objects;
create policy documents_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[2] = public.current_tenant_id()::text
  );

drop policy if exists documents_storage_insert on storage.objects;
create policy documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[2] = public.current_tenant_id()::text
  );

drop policy if exists documents_storage_update on storage.objects;
create policy documents_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[2] = public.current_tenant_id()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[2] = public.current_tenant_id()::text
  );

drop policy if exists documents_storage_delete on storage.objects;
create policy documents_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'tenants'
    and (storage.foldername(name))[2] = public.current_tenant_id()::text
    and public.is_employer()
  );

-- ---------------------------------------------------------------------------
-- Accountant role + access grants (cross-tenant, explicit only)
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'employer', 'employee', 'accountant'));

alter table public.profiles drop constraint if exists profiles_super_admin_tenant_check;
alter table public.profiles
  add constraint profiles_role_tenant_check check (
    (role = 'super_admin' and tenant_id is null)
    or (role = 'accountant' and tenant_id is null)
    or (role in ('employer', 'employee'))
  );

create or replace function public.is_accountant()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'accountant' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_accountant() to authenticated;

create table if not exists public.accountant_access_grants (
  id uuid primary key default gen_random_uuid(),
  client_tenant_id uuid not null references public.tenants (id) on delete cascade,
  accountant_user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete restrict,
  scopes text[] not null default array['accounting_read', 'documents_read']::text[],
  period_from date,
  period_to date,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked', 'expired')),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accountant_access_grants_unique unique (client_tenant_id, accountant_user_id)
);

create index if not exists accountant_grants_accountant_idx
  on public.accountant_access_grants (accountant_user_id)
  where status = 'active';

create index if not exists accountant_grants_tenant_idx
  on public.accountant_access_grants (client_tenant_id);

create or replace function public.accountant_has_tenant_access(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.accountant_access_grants g
    where g.accountant_user_id = auth.uid()
      and g.client_tenant_id = p_tenant_id
      and g.status = 'active'
      and (g.period_to is null or g.period_to >= current_date)
  );
$$;

grant execute on function public.accountant_has_tenant_access(uuid) to authenticated;

alter table public.accountant_access_grants enable row level security;

drop policy if exists accountant_grants_select on public.accountant_access_grants;
create policy accountant_grants_select on public.accountant_access_grants
  for select to authenticated
  using (
    public.is_super_admin()
    or accountant_user_id = auth.uid()
    or (
      public.is_employer()
      and client_tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

drop policy if exists accountant_grants_insert_employer on public.accountant_access_grants;
create policy accountant_grants_insert_employer on public.accountant_access_grants
  for insert to authenticated
  with check (
    public.is_employer()
    and client_tenant_id = public.current_tenant_id()
    and public.current_tenant_id() is not null
    and invited_by = auth.uid()
  );

drop policy if exists accountant_grants_update_parties on public.accountant_access_grants;
create policy accountant_grants_update_parties on public.accountant_access_grants
  for update to authenticated
  using (
    public.is_super_admin()
    or accountant_user_id = auth.uid()
    or (
      public.is_employer()
      and client_tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  )
  with check (
    public.is_super_admin()
    or accountant_user_id = auth.uid()
    or (
      public.is_employer()
      and client_tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- ---------------------------------------------------------------------------
-- Accounting periods + handover packs
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  label text not null,
  period_type text not null
    check (period_type in ('month', 'quarter', 'year', 'custom')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'in_progress'
    check (status in (
      'in_progress',
      'awaiting_missing_info',
      'ready_for_review',
      'approved_by_owner',
      'handed_over',
      'in_review_by_accountant',
      'returned_for_correction',
      'processed_by_accountant'
    )),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_periods_range check (ends_on >= starts_on),
  constraint accounting_periods_tenant_label_uidx unique (tenant_id, label)
);

create table if not exists public.accounting_period_packs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  period_id uuid not null references public.accounting_periods (id) on delete cascade,
  version_number int not null check (version_number > 0),
  status text not null default 'draft'
    check (status in ('draft', 'sealed', 'handed_over', 'superseded')),
  manifest jsonb not null default '{}'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  export_document_id uuid references public.documents (id) on delete set null,
  sealed_at timestamptz,
  handed_over_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint accounting_period_packs_version_uidx unique (period_id, version_number)
);

create table if not exists public.accounting_period_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  period_id uuid not null references public.accounting_periods (id) on delete cascade,
  pack_id uuid references public.accounting_period_packs (id) on delete set null,
  author_id uuid not null references public.profiles (id) on delete cascade,
  visibility text not null default 'shared'
    check (visibility in ('shared', 'owner_only', 'accountant_only')),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.accountant_access_audit (
  id uuid primary key default gen_random_uuid(),
  client_tenant_id uuid not null references public.tenants (id) on delete cascade,
  accountant_user_id uuid references public.profiles (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.accounting_periods enable row level security;
alter table public.accounting_period_packs enable row level security;
alter table public.accounting_period_notes enable row level security;
alter table public.accountant_access_audit enable row level security;

drop policy if exists accounting_periods_access on public.accounting_periods;
create policy accounting_periods_access on public.accounting_periods
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
    or public.accountant_has_tenant_access(tenant_id)
  );

drop policy if exists accounting_periods_write_employer on public.accounting_periods;
create policy accounting_periods_write_employer on public.accounting_periods
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

drop policy if exists accounting_packs_access on public.accounting_period_packs;
create policy accounting_packs_access on public.accounting_period_packs
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
    or public.accountant_has_tenant_access(tenant_id)
  );

drop policy if exists accounting_packs_write_employer on public.accounting_period_packs;
create policy accounting_packs_write_employer on public.accounting_period_packs
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

drop policy if exists accounting_notes_access on public.accounting_period_notes;
create policy accounting_notes_access on public.accounting_period_notes
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
      and visibility in ('shared', 'owner_only')
    )
    or (
      public.accountant_has_tenant_access(tenant_id)
      and visibility in ('shared', 'accountant_only')
    )
  );

drop policy if exists accounting_notes_insert on public.accounting_period_notes;
create policy accounting_notes_insert on public.accounting_period_notes
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      (
        public.is_employer()
        and tenant_id = public.current_tenant_id()
        and public.current_tenant_id() is not null
      )
      or public.accountant_has_tenant_access(tenant_id)
    )
  );

drop policy if exists accountant_access_audit_select on public.accountant_access_audit;
create policy accountant_access_audit_select on public.accountant_access_audit
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and client_tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
    or accountant_user_id = auth.uid()
  );

-- Accountant read path for documents of granted tenants
drop policy if exists documents_accountant_select on public.documents;
create policy documents_accountant_select on public.documents
  for select to authenticated
  using (
    soft_deleted_at is null
    and public.accountant_has_tenant_access(tenant_id)
  );

drop policy if exists document_versions_accountant_select on public.document_versions;
create policy document_versions_accountant_select on public.document_versions
  for select to authenticated
  using (public.accountant_has_tenant_access(tenant_id));
