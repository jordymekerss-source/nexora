# DATABASE_SCHEMA

## Migrations

| File | Contents |
|---|---|
| `20251106190000_initial_schema.sql` | tenants, profiles, projects, time_entries, project_photos, RLS, storage |
| `20251106220000_quotes_invoices.sql` | quotes, quote_items, invoices, invoice_items + RLS |
| `20251109220000_clients_crm_planning.sql` | clients, project_schedules, quote/invoice client links |
| `20251109230000_ops_modules.sql` | project_assignments, vehicles, tools, employee_certificates, work_orders |
| `20251109240000` … `20251110010000` | audit/time corrections, security, stabilize, auth invites, billing RPCs |
| `20251111000000_phase1_foundation_dms_accountant.sql` | DMS, quotas, feature_entitlements, outbox, accountant grants/periods/packs |

## Phase 1 tables

- `feature_entitlements`
- `domain_outbox`
- `documents`, `document_versions`, `upload_sessions`, `storage_usage`
- `accountant_access_grants`, `accountant_access_audit`
- `accounting_periods`, `accounting_period_packs`, `accounting_period_notes`
- tenants: `storage_quota_bytes`, `subscription_tier`
- profiles role: adds `accountant`

## Money

Amounts stored as `numeric(10,2)` — **does not meet** integer-cent requirement yet. App helpers use cents. See FIN-001.

Never edit applied historical migrations in place.
