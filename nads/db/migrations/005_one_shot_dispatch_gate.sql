-- P0.8: persistent one-shot Automation dispatch authorization gate.
-- Apply after 004_completion_claim_leases.sql.

create table if not exists one_shot_dispatch_gates (
  gate_id text primary key default 'default',
  approved_task_id uuid not null,
  status text not null
    check (status in ('armed', 'consumed', 'disarmed')),
  armed_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by text,
  last_outcome text,
  updated_at timestamptz not null default now()
);

create index if not exists one_shot_dispatch_gates_status_idx
  on one_shot_dispatch_gates (status);

comment on table one_shot_dispatch_gates is
  'Atomic one-time authorization for NADS_SINGLE_TASK_MODE Automation sends. Re-arm explicitly after consume/uncertain.';
