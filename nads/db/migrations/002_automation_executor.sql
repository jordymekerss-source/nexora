-- Additive fields for NADS_EXECUTOR=automation (no SaaS impact).

alter table development_tasks
  add column if not exists executor_kind text
    check (executor_kind is null or executor_kind in ('automation', 'cursor', 'mock')),
  add column if not exists external_execution_id text,
  add column if not exists pr_number int,
  add column if not exists pr_url text,
  add column if not exists head_branch text,
  add column if not exists dispatch_idempotency_key text;

create unique index if not exists development_tasks_dispatch_idempotency_uidx
  on development_tasks (dispatch_idempotency_key)
  where dispatch_idempotency_key is not null;

alter table agent_sessions
  add column if not exists executor_kind text
    check (executor_kind is null or executor_kind in ('automation', 'cursor', 'mock'));

create table if not exists webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references development_projects (id) on delete cascade,
  provider text not null check (provider in ('github', 'automation_callback')),
  delivery_id text not null,
  event_type text not null,
  payload_hash text,
  task_id uuid references development_tasks (id) on delete set null,
  processed_at timestamptz not null default now(),
  constraint webhook_receipts_provider_delivery unique (project_id, provider, delivery_id)
);
