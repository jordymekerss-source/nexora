# NADS production database configuration

**Required for multi-instance production webhook/completion safety.**

## Connection

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** (production) | PostgreSQL connection string, e.g. `postgresql://nads:SECRET@db-host:5432/nads` |
| `NADS_WEBHOOK_RECEIPT_STORE` | **Yes** (production) | Must be `postgres` |
| `NADS_REQUIRE_PG_RECEIPTS` | Recommended | `true` — refuses memory fallback |
| `NADS_COMPLETION_LEASE_MS` | Optional | Lease TTL for completion claims (default 900000 = 15m) |

## Migrations

Apply in order against the NADS database (separate from SaaS Supabase):

1. `db/migrations/001_init.sql`
2. `db/migrations/002_automation_executor.sql`
3. `db/migrations/003_webhook_receipts_hardening.sql`
4. `db/migrations/004_completion_claim_leases.sql`

Helper: `applyNadsMigrations(DATABASE_URL)` in `src/db/pg-migrate.ts`.

## Store modes

| Mode | Use |
|---|---|
| `postgres` | **Production / multi-instance.** Atomic `INSERT … ON CONFLICT` deliveries + leased completion claims. |
| `memory` | Unit tests / single-process dry-run only. |
| `file` | Single-node local persistence only. **Not safe for multi-instance production.** |

Production must **not** silently fall back to memory when Postgres is requested or required.

## Schema notes (P0.7 reconcile)

- `webhook_receipts`: durable delivery dedupe; providers `github`, `automation_callback`, `completion_claim`.
- `task_completion_claims`: exclusive recoverable leases (`leased` → `completed` / released on failure / expired recovery).
- `development_tasks`: dispatch binding fields (`expected_repo_url`, `expected_branch_prefix`, `expected_task_marker`, `dispatch_uncertain`, …).

## Integration tests

```bash
export DATABASE_URL=postgresql://nads:nads@127.0.0.1:5432/nads_test
export NADS_PG_INTEGRATION=1
cd nads && npm test -- tests/p07-postgres-receipts.integration.test.ts
```

Set `NADS_PG_INTEGRATION=0` to skip when Postgres is unavailable.
