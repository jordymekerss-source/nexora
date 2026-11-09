# DEPLOYMENT

## Current (demo worker)

- Host: Hetzner VPS
- Process: `next start -H 0.0.0.0 -p 3000`
- Env: `NEXT_PUBLIC_DEMO_MODE=true`
- Firewall: TCP 3000 must be open
- **Not** HTTPS, Docker, or multi-env

## Target production

1. Docker image + Compose: app, (optional) edge proxy, backups job
2. TLS reverse proxy (Caddy/Nginx)
3. Managed Postgres/Supabase
4. Env separation: development / test / staging / production
5. Health check endpoint
6. Backup + restore runbook

Do not deploy to paid platforms without explicit approval.
