# DATABASE_SCHEMA

## Migrations

| File | Contents |
|---|---|
| `20251106190000_initial_schema.sql` | tenants, profiles, projects, time_entries, project_photos, RLS, storage |
| `20251106220000_quotes_invoices.sql` | quotes, quote_items, invoices, invoice_items + RLS |
| `20251109220000_clients_crm_planning.sql` | clients, project_schedules, quote/invoice client links |
| `20251109230000_ops_modules.sql` | project_assignments, vehicles, tools, employee_certificates, work_orders |

## Money

Amounts stored as `numeric(10,2)` — **does not meet** integer-cent requirement yet. See FIN-001.

## Planned additions (Phase 1)

- `audit_events`
- `break_entries`
- `time_entry_corrections`
- `module_configs`
- `memberships` / permission tables

Exact DDL ships in new migrations; never edit applied historical migrations in place.
