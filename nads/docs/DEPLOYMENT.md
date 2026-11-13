# NADS deployment readiness

**Status:** prepared artifacts only — this document does not activate send/ingress or claim a live deploy.

## Architecture

| Component | Role |
|---|---|
| NADS Node process | CLI + optional receive-only HTTP ingress (`:8787`) |
| PostgreSQL 16 | Receipts, completion leases, uncertain dispatch state |
| Reverse proxy (nginx/Caddy) | TLS termination + rate limits |
| Redis | **Not required** by the Automation path (optional placeholder only) |
| Cursor Automation webhook | Executor (outbound from NADS when enabled) |
| GitHub webhooks | Completion evidence (inbound to NADS ingress) |

## Persistence safety tiers

| Mode | Receipts | Dispatch state | Safe for |
|---|---|---|---|
| `memory` | process RAM | process RAM | unit tests / dry-run |
| `file` | `.nads/*.json` | `.nads/*.json` | single-node local only |
| `postgres` | `DATABASE_URL` | `DATABASE_URL` | **multi-instance production** |

Production fail-closed: set `NADS_PRODUCTION=true` (or `NADS_REQUIRE_PG_RECEIPTS=true`). Memory/file are refused.

## Database migrations

```bash
export DATABASE_URL=postgresql://nads:SECRET@db-host:5432/nads
cd nads
node --import tsx -e 'import{applyNadsMigrations}from"./src/db/pg-migrate.ts"; await applyNadsMigrations(process.env.DATABASE_URL)'
```

Order: `001` → `002` → `003` → `004`.

## Docker

```bash
cd nads
docker compose up --build postgres
# apply migrations against localhost:5432
docker compose run --rm nads node dist/cli.js readiness-status
```

Ingress (only after secrets + checklist):

```bash
NADS_INGRESS_ENABLED=true \
NADS_AUTOMATION_ENABLED=false \
docker compose run --rm -p 8787:8787 nads node dist/cli.js ingress-serve
```

## Health / readiness

- `GET /health` — process up (does not prove DB)
- `GET /ready` — fails closed when Postgres ping fails (postgres receipt store)

## Secrets management

Store in the host secret manager / Cursor secrets / compose env files **outside git**:

- `NADS_AUTOMATION_WEBHOOK_URL`
- `NADS_AUTOMATION_WEBHOOK_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_TOKEN`
- `DATABASE_URL`
- `OPENAI_API_KEY` (reviewer)
- `NADS_AUTOMATION_CALLBACK_SECRET` (optional callback)

Never commit real values. `.env.example` holds names only.

## Logging / monitoring

- Ingress responses use stable error codes (`invalid_signature`, `rate_limited`, …) without secrets.
- Dispatch events include `classification`: `accepted` | `failed` | `uncertain` | `reconciled` | `disabled` | `blocked`.
- Prefer shipping stdout JSON to your log drain; alert on `classification=uncertain` and `/ready` ≠ 200.

## Backup / recovery

- Backup PostgreSQL (`pg_dump`) for `development_*`, `webhook_receipts`, `task_completion_claims`.
- After restore, run `recoverExpiredLeases` on receipt store (or wait for next acquire).
- Uncertain dispatches restore from `development_tasks.dispatch_uncertain` — reconcile manually before re-dispatch.

## Restart / rollback

- Restart: redeploy container; no Automation POST on boot.
- Rollback: previous image + prior migration dump if schema changed.
- Keep `NADS_AUTOMATION_ENABLED=false` during rollback verification.

## Remaining manual steps (host not connected here)

1. Provision Postgres + apply migrations 001–004.
2. Create Cursor Automation; paste instructions from `AUTOMATION_INSTRUCTIONS.md`.
3. Configure secrets on the host.
4. Point GitHub webhook to `https://<host>/webhooks/github`.
5. Verify `/health` + `/ready` over HTTPS.
6. Controlled staging: enable ingress first (receive-only), then later enable Automation send for one task.
