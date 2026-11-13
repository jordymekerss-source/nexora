# Controlled staging activation checklist

Do **not** flip these gates until each row is verified.

## Keep disabled during prep

- [x] `NADS_AUTOMATION_ENABLED=false`
- [x] `NADS_INGRESS_ENABLED=false`
- [x] `NADS_ALLOW_CURSOR_API_SMOKE=false`
- [x] No live Automation POST from NADS
- [x] No PR merge / no production deploy from Automation instructions

## Before first receive-only ingress

1. [ ] Postgres provisioned; migrations 001–004 applied
2. [ ] `NADS_WEBHOOK_RECEIPT_STORE=postgres`
3. [ ] `NADS_DISPATCH_STATE_STORE=postgres`
4. [ ] `NADS_REQUIRE_PG_RECEIPTS=true` (or `NADS_PRODUCTION=true`)
5. [ ] `DATABASE_URL` set (secret store)
6. [ ] `GITHUB_WEBHOOK_SECRET` set
7. [ ] `GITHUB_TOKEN` + `GITHUB_REPO` set
8. [ ] HTTPS reverse proxy with rate limits (`deploy/nginx-nads.conf.example`)
9. [ ] `npm run readiness-status` shows multi-instance-safe persistence
10. [ ] `/health` and `/ready` return ok behind TLS

## Before first Automation send (single task)

1. [ ] Cursor Automation created; static instructions pasted from `AUTOMATION_INSTRUCTIONS.md`
2. [ ] `NADS_AUTOMATION_WEBHOOK_URL` + `NADS_AUTOMATION_WEBHOOK_KEY` set
3. [ ] `NADS_EXECUTOR=automation`
4. [ ] Dry-run: `npm run automation-dispatch-dry` (still disabled send) succeeds
5. [ ] Ingress receive path tested with a signed GitHub `ping` / sample delivery in staging
6. [ ] On-call knows how to reconcile uncertain dispatches (`reconcileUncertainDispatch`)
7. [ ] Only then: temporary `NADS_AUTOMATION_ENABLED=true` for **one** task; watch classification events
8. [ ] Immediately set back to `false` if anything is uncertain/failed

## Abort conditions

- `/ready` unhealthy
- Postgres unavailable
- Any path attempting `/v1/agents`
- Uncertain dispatch without operator reconcile
- PR verification failures indicating spoofing
