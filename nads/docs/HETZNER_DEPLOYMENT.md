# NADS on Hetzner Ubuntu VPS

**Mode documented here:** receive-only staging first (`NADS_AUTOMATION_ENABLED=false`).  
**Compose file:** `compose.hetzner.yml`  
**Env template:** `.env.hetzner.example` → copy to `.env.hetzner` (never commit).

This guide does **not** claim your VPS is already configured.

---

## 1. Ubuntu server preparation

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx
# Docker Engine (official docs) + compose plugin
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # re-login after
```

Certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo mkdir -p /var/www/certbot
```

---

## 2. Repository checkout

```bash
sudo mkdir -p /opt/nexora && sudo chown $USER:$USER /opt/nexora
cd /opt/nexora
git clone https://github.com/jordymekerss-source/nexora.git
cd nexora
git fetch origin
git checkout cursor/nads-openai-live-review-6aee
git rev-parse HEAD   # record the deployed SHA for rollback
cd nads
```

---

## 3. Secret generation

```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -hex 32      # GITHUB_WEBHOOK_SECRET
```

Create a GitHub fine-grained or classic PAT with repo read + PR/checks read (completion verification).

---

## 4. Environment configuration

```bash
cp .env.hetzner.example .env.hetzner
chmod 600 .env.hetzner
$EDITOR .env.hetzner
```

### Mandatory for receive-only ingress

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | Strong DB password (no default) |
| `GITHUB_WEBHOOK_SECRET` | HMAC for inbound GitHub webhooks |
| `GITHUB_TOKEN` | PR/branch verification |
| `GITHUB_REPO` / `NADS_REPO_URL` | Repository identity |
| `NADS_INGRESS_ENABLED=true` | Start receive endpoints |
| `NADS_AUTOMATION_ENABLED=false` | **Must stay false** for receive-only |
| Postgres receipt/dispatch flags | Already defaulted in compose |

### Optional until Automation dispatch

| Variable | Purpose |
|---|---|
| `NADS_AUTOMATION_WEBHOOK_URL` | From Cursor Automation UI |
| `NADS_AUTOMATION_WEBHOOK_KEY` | From Cursor Automation UI |
| `NADS_APPROVED_TASK_ID` | Required when enabling one-shot send |
| `OPENAI_API_KEY` | Independent reviewer on completion |

Set `NADS_PUBLIC_HOST` to your DNS name for nginx/docs.

---

## 5. Docker build

```bash
cd /opt/nexora/nads
docker compose -f compose.hetzner.yml --env-file .env.hetzner build
```

---

## 6. PostgreSQL startup

```bash
docker compose -f compose.hetzner.yml --env-file .env.hetzner up -d postgres
docker compose -f compose.hetzner.yml --env-file .env.hetzner ps
```

Postgres has **no published host port**.

---

## 7. Migrations 001–005 (compiled image — no tsx)

Postgres must already be healthy (step 6). Prefer leaving compose networking attached so hostname `postgres` resolves:

```bash
set -a && source .env.hetzner && set +a
docker compose -f compose.hetzner.yml --env-file .env.hetzner run --rm \
  nads node dist/cli.js migrate
```

Equivalent (explicit URL; still requires the compose project network + running postgres):

```bash
docker compose -f compose.hetzner.yml --env-file .env.hetzner run --rm \
  -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  nads node dist/cli.js migrate
```

Expected JSON: `"migrations":["001","002","003","004","005"]`.

Production runtime uses `node dist/cli.js migrate` (compiled). Local-dev equivalent is `npm run migrate` (tsx) — do not require tsx on the VPS image.

---

## 8. Readiness verification

```bash
docker compose -f compose.hetzner.yml --env-file .env.hetzner run --rm \
  nads node dist/cli.js readiness-status
```

Confirm `persistence.multiInstanceSafe: true` and `NADS_AUTOMATION_ENABLED: false`.

---

## 9. Receive-only ingress startup

```bash
docker compose -f compose.hetzner.yml --env-file .env.hetzner up -d
docker compose -f compose.hetzner.yml --env-file .env.hetzner ps
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8787/ready
```

`health` must show `automationSend: false`.  
Compose healthchecks cover Postgres (`pg_isready`) and NADS (`GET /health` via Node fetch).  
Port **8787 is bound to 127.0.0.1 only** on the host; the process listens on `0.0.0.0:8787` inside the container.

---

## 10. Nginx + HTTPS

```bash
sudo cp deploy/nginx-hetzner.conf.example /etc/nginx/sites-available/nads
sudo sed -i 's/nads.example.com/YOUR_HOST/' /etc/nginx/sites-available/nads
sudo ln -sf /etc/nginx/sites-available/nads /etc/nginx/sites-enabled/nads
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d YOUR_HOST
sudo certbot renew --dry-run
```

Webhook path preserves raw body for HMAC (`proxy_request_buffering on`).

---

## 11. GitHub webhook registration (manual)

1. Repo → Settings → Webhooks → Add webhook  
2. Payload URL: `https://YOUR_HOST/webhooks/github`  
3. Content type: `application/json`  
4. Secret: same as `GITHUB_WEBHOOK_SECRET`  
5. Events: `pull_request`, `check_run`, `check_suite`, `workflow_run` (and allow `ping`)  
6. Confirm Recent Deliveries: `ping` → HTTP 200  

Do this only after `/ready` is healthy over HTTPS.

---

## 12. First one-task Automation activation (separate from receive-only)

Still **manual** and gated:

1. Create Cursor Automation; paste `docs/AUTOMATION_INSTRUCTIONS.md`  
2. Put URL/key into `.env.hetzner`  
3. Choose exactly one approved task UUID  
4. Arm one-shot gate (does **not** send):

```bash
docker compose -f compose.hetzner.yml --env-file .env.hetzner run --rm \
  nads node dist/cli.js one-shot-arm <TASK_UUID>
# also set NADS_APPROVED_TASK_ID=<TASK_UUID> in .env.hetzner
```

5. Temporarily set `NADS_AUTOMATION_ENABLED=true`  
6. Dispatch **once** for that task (operator script / future CLI)  
7. Immediately set `NADS_AUTOMATION_ENABLED=false` again  
8. If outcome is `uncertain` → reconcile + **explicit** `one-shot-rearm` before any further send  

Concurrent second send is blocked by the consumed gate.

---

## Distinction

| Phase | Ingress | Automation send | One-shot |
|---|---|---|---|
| Receive-only (this default) | on | **off** | unused |
| First live send | on | briefly on | armed → consumed |

---

## Rollback / stop

```bash
docker compose -f compose.hetzner.yml --env-file .env.hetzner down
# data retained in volume nads_pg_data unless -v
```
