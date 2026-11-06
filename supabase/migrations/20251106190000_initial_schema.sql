-- NEXORA Core MVP — Initial schema, RLS, and storage policies
-- Run in Supabase SQL Editor or via supabase db push

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid references public.tenants (id),
  full_name text not null,
  role text not null check (role in ('super_admin', 'employer', 'employee')),
  phone text,
  created_at timestamptz not null default now(),
  constraint profiles_super_admin_tenant_check check (
    role <> 'super_admin' or tenant_id is null
  )
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text not null,
  client_name text,
  address text not null,
  status text not null default 'active' check (status in ('planning', 'active', 'completed')),
  created_at timestamptz not null default now()
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  clock_in timestamptz not null,
  clock_out timestamptz,
  break_minutes int not null default 0,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved'))
);

create table public.project_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  photo_url text not null,
  caption text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index projects_tenant_id_idx on public.projects (tenant_id);
create index time_entries_tenant_id_idx on public.time_entries (tenant_id);
create index time_entries_user_id_idx on public.time_entries (user_id);
create index time_entries_project_id_idx on public.time_entries (project_id);
create index project_photos_tenant_id_idx on public.project_photos (tenant_id);
create index project_photos_project_id_idx on public.project_photos (project_id);
create index profiles_tenant_id_idx on public.profiles (tenant_id);

-- ---------------------------------------------------------------------------
-- Helper functions (stable for RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'super_admin' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select (select p.tenant_id from public.profiles p where p.id = auth.uid());
$$;

create or replace function public.is_employer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'employer' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.is_employee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'employee' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

grant execute on function public.current_profile() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_employer() to authenticated;
grant execute on function public.is_employee() to authenticated;

-- ---------------------------------------------------------------------------
-- Integrity triggers (project + profile must match row tenant)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_time_entry_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.projects as p
    where p.id = new.project_id
      and p.tenant_id = new.tenant_id
  ) then
    raise exception 'time_entries: project_id must belong to tenant_id';
  end if;

  if not exists (
    select 1
    from public.profiles as pr
    where pr.id = new.user_id
      and pr.tenant_id = new.tenant_id
  ) then
    raise exception 'time_entries: user_id must belong to tenant_id';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_project_photo_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.projects as p
    where p.id = new.project_id
      and p.tenant_id = new.tenant_id
  ) then
    raise exception 'project_photos: project_id must belong to tenant_id';
  end if;

  if not exists (
    select 1
    from public.profiles as pr
    where pr.id = new.user_id
      and pr.tenant_id = new.tenant_id
  ) then
    raise exception 'project_photos: user_id must belong to tenant_id';
  end if;

  return new;
end;
$$;

create trigger time_entries_enforce_references
  before insert or update on public.time_entries
  for each row
  execute function public.enforce_time_entry_references();

create trigger project_photos_enforce_references
  before insert or update on public.project_photos
  for each row
  execute function public.enforce_project_photo_references();

-- ---------------------------------------------------------------------------
-- Auth: bootstrap profile row on signup
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

  v_role := coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'employee');
  if v_role not in ('super_admin', 'employer', 'employee') then
    v_role := 'employee';
  end if;

  if new.raw_user_meta_data ? 'tenant_id'
     and nullif(trim(new.raw_user_meta_data->>'tenant_id'), '') is not null then
    begin
      v_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;
    exception
      when invalid_text_representation then
        v_tenant_id := null;
    end;
  else
    v_tenant_id := null;
  end if;

  if v_role = 'super_admin' then
    v_tenant_id := null;
  end if;

  insert into public.profiles (id, tenant_id, full_name, role)
  values (new.id, v_tenant_id, v_full_name, v_role);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.time_entries enable row level security;
alter table public.project_photos enable row level security;

-- tenants
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    public.is_super_admin()
    or id = public.current_tenant_id()
  );

create policy tenants_insert on public.tenants
  for insert to authenticated
  with check (public.is_super_admin());

create policy tenants_update on public.tenants
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy tenants_delete on public.tenants
  for delete to authenticated
  using (public.is_super_admin());

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.is_super_admin()
    or id = auth.uid()
    or (
      public.is_employer()
      and tenant_id is not distinct from public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id is not distinct from public.current_tenant_id()
      and public.current_tenant_id() is not null
      and role in ('employer', 'employee')
    )
  );

create policy profiles_update_super_admin on public.profiles
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy profiles_update_employer on public.profiles
  for update to authenticated
  using (
    public.is_employer()
    and tenant_id is not distinct from public.current_tenant_id()
    and public.current_tenant_id() is not null
  )
  with check (
    public.is_employer()
    and tenant_id is not distinct from public.current_tenant_id()
    and public.current_tenant_id() is not null
  );

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id is not distinct from public.current_tenant_id()
      and public.current_tenant_id() is not null
      and id <> auth.uid()
    )
  );

-- projects
create policy projects_select on public.projects
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
      and (
        public.is_employer()
        or (public.is_employee() and status = 'active')
      )
    )
  );

create policy projects_insert on public.projects
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

create policy projects_update on public.projects
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

create policy projects_delete on public.projects
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- time_entries
create policy time_entries_select on public.time_entries
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
      and user_id = auth.uid()
      and tenant_id = public.current_tenant_id()
    )
  );

create policy time_entries_insert on public.time_entries
  for insert to authenticated
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
      and public.current_tenant_id() is not null
      and status = 'pending'
    )
  );

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

create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_employer()
      and tenant_id = public.current_tenant_id()
      and public.current_tenant_id() is not null
    )
  );

-- project_photos
create policy project_photos_select on public.project_photos
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
      and user_id = auth.uid()
      and tenant_id = public.current_tenant_id()
    )
  );

create policy project_photos_insert on public.project_photos
  for insert to authenticated
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
      and public.current_tenant_id() is not null
    )
  );

create policy project_photos_update on public.project_photos
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
    )
  );

create policy project_photos_delete on public.project_photos
  for delete to authenticated
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
    )
  );

-- ---------------------------------------------------------------------------
-- Storage bucket for project photos (private; URLs signed in app)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('project-photos', 'project-photos', false)
on conflict (id) do nothing;

create policy project_photos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-photos'
    and (
      public.is_super_admin()
      or (
        (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (
          public.is_employer()
          or public.is_employee()
        )
      )
    )
  );

create policy project_photos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-photos'
    and (
      public.is_super_admin()
      or (
        (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (public.is_employer() or public.is_employee())
      )
    )
  );

create policy project_photos_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-photos'
    and (
      public.is_super_admin()
      or (
        (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.is_employer()
      )
    )
  );

create policy project_photos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-photos'
    and (
      public.is_super_admin()
      or (
        (storage.foldername(name))[1] = public.current_tenant_id()::text
        and public.is_employer()
      )
      or (
        public.is_employee()
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and split_part(name, '/', 3) = auth.uid()::text
      )
    )
  );
