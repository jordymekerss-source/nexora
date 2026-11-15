-- Optimistic concurrency for development_tasks status snapshots.
-- Compare-and-swap on row_version prevents lost updates across workers.

alter table development_tasks
  add column if not exists row_version bigint not null default 0;

comment on column development_tasks.row_version is
  'Monotonic optimistic-concurrency token; persistTaskSnapshot CAS-updates this column.';
