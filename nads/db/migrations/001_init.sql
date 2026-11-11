-- NADS control-plane schema (PostgreSQL). Separate from SaaS Supabase tenants.

create extension if not exists "pgcrypto";

create table if not exists development_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repository_url text not null,
  default_branch text not null default 'main',
  integration_branch text not null default 'cursor/integration',
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists development_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references development_projects (id) on delete cascade,
  parent_task_id uuid references development_tasks (id) on delete set null,
  title text not null,
  description text not null default '',
  priority int not null default 100,
  category text not null default 'general',
  status text not null default 'READY',
  acceptance_criteria jsonb not null default '[]'::jsonb,
  implementation_plan text,
  assigned_agent_id text,
  retry_count int not null default 0,
  max_retries int not null default 3,
  lock_owner text,
  lock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists development_tasks_status_priority_idx
  on development_tasks (status, priority, created_at);

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references development_tasks (id) on delete cascade,
  provider text not null default 'cursor',
  provider_agent_id text,
  provider_run_id text,
  branch_name text,
  status text not null default 'created',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

create table if not exists development_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references development_tasks (id) on delete cascade,
  agent_session_id uuid references agent_sessions (id) on delete set null,
  iteration int not null default 1,
  prompt text not null,
  result text,
  review_decision text
    check (review_decision is null or review_decision in ('ACCEPT', 'REJECT', 'BLOCKED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists code_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references development_tasks (id) on delete cascade,
  run_id uuid not null references development_runs (id) on delete cascade,
  decision text not null check (decision in ('ACCEPT', 'REJECT', 'BLOCKED')),
  findings jsonb not null default '{}'::jsonb,
  required_changes jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  reviewer_model text not null,
  created_at timestamptz not null default now()
);

create table if not exists test_executions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references development_tasks (id) on delete cascade,
  run_id uuid references development_runs (id) on delete set null,
  test_type text not null,
  command text not null,
  exit_code int,
  output_reference text,
  status text not null check (status in ('passed', 'failed', 'blocked', 'not_executed')),
  created_at timestamptz not null default now()
);

create table if not exists development_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references development_projects (id) on delete cascade,
  task_id uuid references development_tasks (id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint development_events_idempotency unique (project_id, idempotency_key)
);

create table if not exists development_budgets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references development_projects (id) on delete cascade,
  daily_limit numeric(12,2) not null default 25,
  monthly_limit numeric(12,2) not null default 300,
  maximum_run_cost numeric(12,2) not null default 5,
  maximum_iterations int not null default 50,
  current_usage numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists development_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references development_projects (id) on delete cascade,
  autonomous_enabled boolean not null default false,
  emergency_stop boolean not null default false,
  max_concurrent_agents int not null default 1,
  max_retries int not null default 3,
  max_iterations int not null default 50,
  allowed_branches text[] not null default array['cursor/integration']::text[],
  updated_at timestamptz not null default now()
);

create table if not exists task_transitions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references development_tasks (id) on delete cascade,
  from_status text not null,
  to_status text not null,
  reason text,
  created_at timestamptz not null default now()
);
