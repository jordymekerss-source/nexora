# ARCHITECTURE_REVIEW

## Observed stack (verified from package.json / source)

- Next.js **14.2.35** App Router + React 18 + TypeScript strict
- Tailwind CSS + small local UI kit
- Supabase Auth + Postgres RLS + Storage (photos)
- Server Actions as primary write API
- Optional **demo mode**: file store `.data/demo-store.json` + persona cookie

**No Prisma, no Redis, no Docker Compose, no PWA service worker** in repo.

## Strengths to retain

- Clear tenant_id column pattern + RLS helpers
- Working CRM → quotes → invoices → planning demo path
- Ops overlays (assignments, fleet, tools, HR, work orders) with SQL schema
- Typed `Database` surface in `src/types/database.ts`

## Structural risks

1. **Dual UX trees:** `/dashboard/*` (live-oriented) vs `/employer/*` + `/employee/*` (demo-heavy). Consolidate gradually; do not delete without migration of links.
2. **Role naming:** DB uses `employer` as company admin. Product language wants `company_admin` / `manager`. Keep `employer` as stable storage value; map in UI copy; add `manager` later via migration without breaking data.
3. **Demo vs live split:** Ops actions still largely demo-gated. Live wiring is Phase C work.
4. **Modular entitlements:** `module_configs` table exists; needs a single server gate used by actions.

## Target modular boundary (retain monolith)

```
UI routes → Server Actions → AuthZ (session + role + entitlement)
  → Domain helpers → Supabase user client | Admin (invites/org only)
  → Postgres RLS
```

Events/queues/PWA remain deferred until Core MVP is stable.
