# Spec — Time tracking

## Current

- `time_entries` with clock_in/out, break_minutes, pending/approved
- Employee mobile clock on assigned projects (demo)
- Employer live active workers on project detail (demo)

## Required (master)

- Real `break_entries` start/stop
- Append-only `time_entry_corrections`
- Configurable CAO rules (no hardcoded universals)
- Offline PWA sync
- Exports

## Schema added

See migration `20251109240000_foundation_audit_time.sql`.
