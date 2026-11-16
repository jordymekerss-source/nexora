# NEXORA Architecture V2

## Style

Modular monolith. Next.js web + future Expo mobile share domain packages in-repo.

```text
src/lib/authorization   # authorize(actor, resource, action)
src/lib/permissions     # Layer 3/4 evaluation
src/lib/entitlements    # Module + feature resolvers (fail-closed)
src/lib/navigation      # Role+module nav catalog
src/domain (future)     # Pure business rules extractable for mobile
```

## Decision

No microservices. Gradual monorepo (`apps/web`, `apps/mobile`, `packages/*`) only when mobile shell lands.

## AuthZ layers

1. Tenant membership  
2. Role  
3. Module + action permissions  
4. Data scope (explicit resource ids; null never means all)

Super Admin tenant data requires `support_access_grants`.
