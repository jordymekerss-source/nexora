# NEXORA Business OS

**Run your business. Build better.**

Premium modular multi-tenant SaaS for field and service companies (Netherlands first).

> **Status:** Not production-ready. Interactive demo + schema foundation.  
> See `docs/AUDIT_REPORT.md`, `BUILD_STATUS.md`, and `SESSION_HANDOFF.md`.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Supabase Auth/Postgres RLS · Demo file store

## Quick demo

```bash
npm install
cp .env.example .env.local
# Ensure NEXT_PUBLIC_DEMO_MODE=true
# For `next start` demo hosts also set ALLOW_DEMO_IN_PRODUCTION=true
npm run dev
```

Open http://localhost:3000 — use the persona switcher to move between employer and employees.

## Live Supabase

1. Apply SQL migrations in `supabase/migrations/` in order.
2. Set `NEXT_PUBLIC_DEMO_MODE=false` and Supabase keys.
3. Never enable demo mode on real tenant production without explicit approval.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build/serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |

## Documentation

All product docs live under `docs/`. Start with `docs/MASTER_SPEC.md` and `docs/AUDIT_REPORT.md`.
