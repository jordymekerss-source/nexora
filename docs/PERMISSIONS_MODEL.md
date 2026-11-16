# Permissions Model

## Layers

1. **Tenant** — membership via `profiles.tenant_id`
2. **Role** — employer / employee / accountant / super_admin
3. **Module + action** — `user_action_permissions` overrides + role defaults
4. **Data scope** — `user_data_scopes` with mandatory `scope_id` for concrete types

## Super Admin

- Platform modules (`platform`, `integrations`) without grant
- Tenant customer data **only** with active `support_access_grants`
- Grant fields: tenant, reason, scopes, window, revocation, audit

## Central API

```ts
authorize(actor, { moduleKey, scopeType?, scopeId?, resourceTenantId? }, action)
```

Frontend may mirror for UX; server/RPC/storage must enforce.
