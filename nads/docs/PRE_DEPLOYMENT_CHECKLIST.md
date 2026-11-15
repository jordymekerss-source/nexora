# NADS pre-deployment checklist & rollback

**Mode:** receive-only staging first.  
**Hard rule:** `NADS_AUTOMATION_ENABLED=false` until a separate, human-authorized activation.

This checklist does **not** authorize deployment. It is the gate before a controlled Hetzner bring-up.

---

## READY FOR CONTROLLED DEPLOYMENT — criteria

All of the following must be true:

- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass on the release SHA
- [ ] No open P0 security findings (heuristic override blocked; CI skipped ≠ success; ACCEPT requires complete GitHub evidence)
- [ ] Production config is fail-closed (`NADS_PRODUCTION=true`, postgres receipts/dispatch, no heuristic reviewer)
- [ ] PostgreSQL persistence verified (task + remediation survive restart)
- [ ] Review evidence binds to head SHA; incomplete/skipped/pending CI cannot ACCEPT
- [ ] One-shot gate required for any live send; single-task + approved task id enforced at dispatch
- [ ] Webhook HMAC + replay/dedupe covered by tests
- [ ] Docker image builds; `compose.hetzner.yml` / `docker-compose.yml` validate
- [ ] Rollback runbook understood (below)
- [ ] `NADS_AUTOMATION_ENABLED=false` in image, compose, and env templates

If any item fails → **NOT READY — BLOCKERS FOUND**.

---

## Pre-flight on the VPS

```bash
hostname   # expect Mekersautomation (or documented host)
cd /opt/nexora/nexora/nads   # or your checkout
git rev-parse HEAD           # record deploy SHA
grep -n 'NADS_AUTOMATION_ENABLED' Dockerfile compose.hetzner.yml .env.hetzner
# must show false / default false — never true for first bring-up
```

Protected paths (do not touch): `/root/nexora-mvp`, `/root/nexora-mvp-backup-*`, `/root/nexora-safety`.

---

## Bring-up (receive-only)

1. Copy `.env.hetzner.example` → `.env.hetzner` (chmod 600); fill secrets.
2. Confirm `NADS_AUTOMATION_ENABLED=false`, `NADS_MODE=live`, `NADS_ALLOW_HEURISTIC_REVIEWER=false`.
3. `docker compose -f compose.hetzner.yml --env-file .env.hetzner config` (validate).
4. Build and start **without** changing existing production volumes unless intentional.
5. Hit `/ready` — must fail if Postgres is unreachable.
6. Apply migrations via documented CLI (`migrate`) before relying on ingress.
7. Configure nginx TLS; keep host bind `127.0.0.1:8787`.

**Do not** arm one-shot, enable Automation send, merge PRs, or open public DB ports in this phase.

---

## Rollback runbook

1. Record failing SHA and symptoms (`docker compose logs nads --tail 200`).
2. Stop the nads service only:  
   `docker compose -f compose.hetzner.yml --env-file .env.hetzner stop nads`
3. Check out the last known-good SHA; rebuild image; start nads again.
4. Postgres volume: **do not** delete `nads_pg_data` unless a deliberate restore from backup is planned.
5. Restore from off-repo backup tarball/bundle if the working tree is corrupted (see `/root/nads-phase1-backups/`).
6. Re-verify `/ready`, webhook signature path with a dry replay of a known delivery id (expect replay/409, not double processing).
7. Keep `NADS_AUTOMATION_ENABLED=false` throughout rollback.

---

## Explicit non-goals of this phase

- No live Cursor Automation dispatch
- No paid OpenAI calls from this checklist
- No automatic PR merge
- No production SaaS (`/root/nexora-mvp`) changes
