# ARCHITECTURE

## Style

Modular monolith on **Next.js App Router** + **Supabase (Postgres Auth Storage)** + **Server Actions**.

No microservices. Domain logic lives in `src/app/actions/*` and `src/lib/*` until packages are split by module boundaries.

## Runtime modes

1. **Demo mode** (`NEXT_PUBLIC_DEMO_MODE=true`): file store `.data/demo-store.json`, persona cookie auth. Local/demo only.
2. **Live mode**: Supabase Auth + RLS. Required for production.

## Layers

```
UI (app routes + components)
  → Server Actions / Route Handlers
    → Auth context (require*Session)
      → Domain services (to be expanded)
        → Supabase client (user-scoped) | Admin client (invites only)
          → PostgreSQL RLS
```

## Multi-tenancy

- `tenant_id` on business rows
- `profiles.role` coarse RBAC (to be replaced/extended by memberships/permissions)
- RLS policies using `current_tenant_id()` / `is_employer()` / `is_super_admin()`

## Intentionally deferred

Redis/queues, outbox events, Docker stack — Phase 1–8 per ROADMAP.
