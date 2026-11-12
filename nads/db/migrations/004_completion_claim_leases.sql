-- P0.7: recoverable completion claim leases + dispatch binding fields.
-- Reconciles runtime lease semantics with migrations 002/003.
-- Apply after 003_webhook_receipts_hardening.sql.

-- Expand webhook receipt providers to match runtime (completion_claim used by memory/file stores).
alter table webhook_receipts
  drop constraint if exists webhook_receipts_provider_check;

alter table webhook_receipts
  add constraint webhook_receipts_provider_check
  check (provider in ('github', 'automation_callback', 'completion_claim'));

-- Lease-aware exclusive completion claims (Postgres path).
alter table task_completion_claims
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists status text not null default 'leased'
    check (status in ('leased', 'completed', 'released', 'failed')),
  add column if not exists payload_hash text,
  add column if not exists failure_reason text,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill: rows without lease metadata behave as permanent completed claims.
update task_completion_claims
set
  status = coalesce(nullif(status, ''), 'completed'),
  lease_expires_at = coalesce(lease_expires_at, claimed_at + interval '1 hour'),
  updated_at = coalesce(updated_at, now())
where lease_expires_at is null
   or lease_owner is null;

create index if not exists task_completion_claims_lease_expiry_idx
  on task_completion_claims (status, lease_expires_at)
  where status = 'leased';

create index if not exists task_completion_claims_project_idx
  on task_completion_claims (project_id);

comment on column task_completion_claims.lease_expires_at is
  'Exclusive lease deadline; expired leased rows may be recovered by another worker.';

comment on column task_completion_claims.status is
  'leased=in progress; completed=terminal success path; released/failed=recoverable.';

-- Bind expected dispatch identity onto the task for mandatory PR verification.
alter table development_tasks
  add column if not exists expected_repo_url text,
  add column if not exists expected_starting_ref text,
  add column if not exists expected_branch_prefix text,
  add column if not exists expected_task_marker text,
  add column if not exists dispatch_outcome text,
  add column if not exists dispatch_uncertain boolean not null default false,
  add column if not exists dispatch_reconcile_token text;

comment on column development_tasks.dispatch_uncertain is
  'True when Automation POST outcome is ambiguous (timeout/5xx). Blocks re-dispatch until reconcile.';
