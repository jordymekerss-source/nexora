-- P0 hardening: persistent webhook receipts + exclusive task completion claims.
-- Additive only. Apply after 002_automation_executor.sql.

alter table webhook_receipts
  add column if not exists status text not null default 'processed'
    check (status in ('processed', 'rejected', 'failed'));

create index if not exists webhook_receipts_task_id_idx
  on webhook_receipts (task_id)
  where task_id is not null;

create index if not exists webhook_receipts_processed_at_idx
  on webhook_receipts (processed_at desc);

-- One completion lifecycle per task (cross-event dedupe).
create table if not exists task_completion_claims (
  task_id uuid primary key references development_tasks (id) on delete cascade,
  project_id uuid not null references development_projects (id) on delete cascade,
  provider text not null check (provider in ('github', 'automation_callback')),
  delivery_id text not null,
  claimed_at timestamptz not null default now(),
  constraint task_completion_claims_delivery unique (project_id, provider, delivery_id)
);

comment on table webhook_receipts is
  'Idempotent ingress receipts; unique (project_id, provider, delivery_id) prevents duplicate processing.';

comment on table task_completion_claims is
  'Exclusive claim so distinct GitHub events cannot complete the same task twice.';
