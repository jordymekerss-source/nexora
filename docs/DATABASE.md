# DATABASE

Canonical schema lives in `supabase/migrations/` (ordered).

| Migration | Purpose |
|---|---|
| `20251106190000_initial_schema.sql` | tenants, profiles, projects, time_entries, photos, RLS, storage |
| `20251106220000_quotes_invoices.sql` | quotes/invoices |
| `20251109220000_clients_crm_planning.sql` | clients, schedules |
| `20251109230000_ops_modules.sql` | assignments, vehicles, tools, certificates, work_orders |
| `20251109240000_foundation_audit_time.sql` | audit_events, break_entries, time_entry_corrections, module_configs |
| `20251109250000_security_hardening.sql` | signup lock, RLS tighten, tenant triggers |
| `20251109260000_mvp_stabilize.sql` | document sequences, storage tighten, manager role prep |

Apply **in order** on every environment. Never edit applied migrations in place.

See also `docs/DATABASE_SCHEMA.md` for column-level notes.
