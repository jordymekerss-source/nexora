# MULTITENANCY

## Model (current)

- One `tenants` row per company
- Users in `profiles` with `tenant_id` (null for `super_admin`)
- Business data scoped by `tenant_id`

## Enforcement

1. Application: `requireEmployerSession` / `requireEmployeeSession` / tenant filters in queries
2. Database: RLS on all current tables

## Gaps

- No memberships table (multi-company users unsupported)
- No per-module entitlements
- Demo store is single-tenant shared JSON
- Isolation **not proven** by automated tests in this environment

## Target model (Phase 1–2)

`companies` (tenants) → `memberships` → `roles` / `permissions` → `module_configs` + RLS still keyed by tenant.
