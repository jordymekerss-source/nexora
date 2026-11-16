# PERMISSIONS MODEL — Four layers

## Layer 1 — NEXORA Super Admin

Controls per-tenant commercial entitlements:
- `module_configs`
- `feature_entitlements`
- storage quotas / subscription tier on `tenants`

## Layer 2 — Employer (company)

Chooses which enabled modules employees may use and assigns roles / invites.

## Layer 3 — Individual action permissions

Table: `user_action_permissions`  
Per `(tenant, user, module_key)`: view/create/edit/delete/approve/export/manage.

If no row exists, **role defaults** apply (`src/lib/permissions/evaluate.ts`).

## Layer 4 — Data scopes

Table: `user_data_scopes`  
Scope types: project, client, folder, document, time, finance, hr, all_projects, all_clients.  
Access: none | read | write | approve | manage.

## Enforcement order

1. Authenticated session  
2. Tenant membership  
3. Module entitlement (Layer 1)  
4. Action permission (Layer 3 / role default)  
5. Data scope (Layer 4)  
6. RLS on the row  

UI hiding is never sufficient.

## Migration

`20251111220000_p0_numbering_permissions.sql`

## Status

Schema + pure evaluators: **present**.  
Full UI for editing Layer 3/4 and wiring every Server Action: **not complete**.
