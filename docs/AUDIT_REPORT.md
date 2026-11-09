# NEXORA BUSINESS OS — Master Audit Report

**Product:** NEXORA Business OS  
**Audit date:** 2026-11-09 (Europe/Amsterdam)  
**Repository:** `/root/nexora-mvp` (`jordymekerss-source/nexora`)  
**Branch audited:** `cursor/nexora-ops-modules-5233` → work continues on `cursor/nexora-master-audit-5233`  
**Auditor role:** Principal Full-Stack / Security / SaaS Platform  
**Method:** Repository inspection, migration review, dependency vulnerability scan (`npm audit`), TypeScript strict build, ESLint, HTTP smoke of live demo routes. **No automated unit/integration/e2e suite exists.**

---

## 1. Executive verdict

| Dimension | Verdict | Summary |
|---|---|---|
| Overall product readiness vs master spec | **NOT PRODUCTION-READY** | Functional demo/MVP covering ~15–25% of approved scope |
| Core demo (CRM, quotes, invoices, planning, ops) | **PARTIAL — demo works** | File-backed store; many employer UIs work in `NEXT_PUBLIC_DEMO_MODE=true` |
| Live Supabase path | **PARTIAL / BLOCKED** | Migrations + RLS exist; ops modules **not wired** to live Supabase actions; no deployed Supabase verified in this worker |
| Multi-tenancy | **PARTIAL** | SQL RLS present for existing tables; demo mode has **no real tenant isolation tests**; single shared demo tenant |
| Security | **FAIL for production** | Demo auth bypass; Next.js 14.2.35 critical advisories; no rate limit/MFA/audit log/support access |
| Tests | **MISSING** | No unit/integration/e2e; only `tsc` + `lint` + manual HTTP smoke |
| PWA / offline | **MISSING** | No service worker, IndexedDB sync, or manifest |
| Super Admin / org tree / modules / GPS / chat / expenses / quality | **MISSING** | Not implemented |

**Honest status:** This is a **working interactive demo + schema foundation**, not a complete Business Operating System.

---

## 2. Repository inventory

### 2.1 Stack (actual)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js **14.2.35** App Router, React 18, TypeScript strict, Tailwind | No Prisma; Supabase JS client |
| Auth | Supabase Auth (live) / cookie persona (demo) | Demo bypasses login |
| DB | PostgreSQL via Supabase migrations | 4 SQL migration files, ~16 tables |
| Storage | Supabase Storage policies for `project_photos` | Demo does not use Storage |
| Jobs/Redis/events | **Absent** | No queue, outbox, Redis |
| Docker / reverse proxy | **Absent** | Live process: `next start -H 0.0.0.0 -p 3000` on Hetzner |
| Tests | **Absent** | Scripts: `dev`, `build`, `start`, `lint`, `typecheck` |

### 2.2 Source map

| Area | Path |
|---|---|
| Auth pages | `src/app/(auth)/login`, `signup` |
| Dashboard (legacy core) | `src/app/dashboard/*` |
| Employer modules | `src/app/(dashboard)/employer/*` |
| Employee mobile | `src/app/(dashboard)/employee/*` |
| Server actions | `src/app/actions/crm_billing.ts`, `ops.ts`, `dashboard/*/actions.ts` |
| Auth helpers | `src/lib/auth/require-user.ts` |
| Demo store | `src/lib/demo/store.ts`, `.data/demo-store.json` |
| Types | `src/types/database.ts` |
| Migrations | `supabase/migrations/*.sql` |
| UI primitives | `src/components/ui/*` |

### 2.3 Routes found (24 pages)

`/`, `/login`, `/signup`, onboarding (3), `/dashboard` (+ projects/time/team), `/employer/{clients,quotes,invoices,planning,projects,fleet,tools,hr}`, `/employee`, `/employee/work-order`.

### 2.4 Database tables (migrations)

`tenants`, `profiles`, `projects`, `time_entries`, `project_photos`, `quotes`, `quote_items`, `invoices`, `invoice_items`, `clients`, `project_schedules`, `project_assignments`, `vehicles`, `tools`, `employee_certificates`, `work_orders` (+ storage bucket policies).

**RLS:** Enabled with policies on all listed application tables in SQL. **Not runtime-tested** against a live Postgres in this environment → status **NOT TESTED** for isolation proofs.

---

## 3. Technical audit

| Check | Result | Evidence |
|---|---|---|
| TypeScript strict + `noUncheckedIndexedAccess` | PASS | `tsconfig.json`; `tsc --noEmit` exit 0 |
| ESLint | PASS | `npm run lint` clean |
| Production build | PASS | `next build` succeeded (ops branch) |
| Dependency advisories | **FAIL (P0)** | `npm audit`: Next 14.2.35 **critical/high** advisories; PostCSS high. Fix path suggests Next 16 (breaking) |
| Prisma | N/A — Supabase SQL used | Acceptable equivalent if RLS + typed client maintained |
| Logging/monitoring | MISSING | No structured logs, APM, health endpoint |
| Background jobs | MISSING | No Redis/queue |
| Money precision | **FAIL** | `src/lib/money.ts` uses IEEE float + `numeric(10,2)` — not integer cents / exact decimal domain |

---

## 4. Functional audit (module matrix)

Legend: **PASS** requires evidence of UI+backend+storage+auth+tests. None meet full PASS for production.

| Module | Status | Evidence | Action |
|---|---|---|---|
| Auth login/signup | PARTIAL | Pages + Supabase callback; demo skips auth | Harden; test live |
| Onboarding org create | PARTIAL | `onboarding/create-organization` | Keep; test |
| Employer dashboard | PARTIAL | `/dashboard` + employer nav | Redesign premium UX later |
| Clients CRM | PARTIAL | Demo+live actions in `crm_billing.ts` | Keep; extend portal later |
| Quotes | PARTIAL | Builder + convert | Keep |
| Invoices | PARTIAL | Generate from hours + print | Keep; accounting exports MISSING |
| Planning | PARTIAL | Weekly schedules UI | Extend calendar views |
| Projects | PARTIAL | CRUD + photos (live Storage) | Multi-assign OK in demo |
| Team invite | PARTIAL | Admin invite API; fails without service role | Keep |
| Time entries | PARTIAL | Dashboard time + employee clock; **no break start/stop, no corrections ledger, no CAO** | Rebuild time domain |
| Project assignments | PARTIAL | Demo ops only; SQL+RLS exist | Wire live Supabase |
| Employee clock-in | PARTIAL | `/employee` demo | Live path MISSING |
| Work order signature | PARTIAL | Canvas → data URL in demo store | Need secure object storage |
| Fleet / tools / HR certs | PARTIAL | Demo UI + SQL | Live actions MISSING |
| Super Admin | MISSING | No UI/API | Build Phase 2 |
| Memberships / granular perms / modules | MISSING | Role enum only (`employer`/`employee`/`super_admin`) | Build Phase 1–2 |
| Org tree | MISSING | — | Build Phase 2 |
| Leave / sick / balances | MISSING | — | Build Phase 3 |
| GPS / private mode | MISSING | — | Build Phase 3 |
| Materials / inventory | MISSING | Tools ≠ inventory | Build Phase 4 |
| Documents / contracts | MISSING | — | Build Phase 5 |
| Customer portal | MISSING | — | Build Phase 5 |
| Chat / notifications | MISSING | — | Build Phase 6 |
| Quality / safety / expenses | MISSING | — | Build Phase 4 |
| Offline PWA | MISSING | No SW/manifest | Build Phase 7 |
| Event bus / webhooks | MISSING | — | Build Phase 6 |
| Docker/prod stack | MISSING | Bare `next start` | Build Phase 8 |
| Automated tests | MISSING | — | P0 foundation |

---

## 5. Security audit

### 5.1 Findings (ranked)

| ID | Sev | Finding | Status |
|---|---|---|---|
| SEC-P0-001 | Critical | `isDemoMode()` auto-enables when Supabase env missing — misconfigured “prod” becomes unauthenticated demo | FAIL |
| SEC-P0-002 | Critical | Demo session from cookie `nexora_demo_persona` — any visitor can assume employer/employee | FAIL for prod (acceptable only if demo hard-gated) |
| SEC-P0-003 | Critical | Next.js 14.2.35 known critical RCE/DoS advisories per `npm audit` | FAIL |
| SEC-P0-004 | High | No automated tenant-isolation tests; RLS **NOT TESTED** live | NOT TESTED |
| SEC-P0-005 | High | Ops/CRM demo write path shares one JSON file on disk — no per-tenant isolation beyond single demo tenant | FAIL for multi-tenant claims |
| SEC-P1-001 | High | Middleware only refreshes session; **no route ACL** | PARTIAL |
| SEC-P1-002 | High | Service role invite path; no rate limiting on auth/actions | MISSING |
| SEC-P1-003 | Medium | Work-order signatures stored as data URLs in demo JSON (no virus scan, size limits weak) | PARTIAL |
| SEC-P1-004 | Medium | No MFA, support-access workflow, audit_events table | MISSING |
| SEC-P1-005 | Medium | Financial amounts via float rounding | FAIL vs exact money requirement |

### 5.2 What is good

- SQL RLS helpers (`current_tenant_id`, `is_employer`, `is_super_admin`) in initial migration.
- Server actions generally call `requireEmployerSession` / `requireEmployeeSession`.
- Storage policies scoped by tenant path for project photos.
- TypeScript strictness reduces some XSS/injection footguns; Supabase parameterized queries.

---

## 6. Database / multi-tenancy audit

| Topic | Status | Notes |
|---|---|---|
| `tenant_id` on business tables | PASS (schema) | Present on domain tables |
| RLS enabled | PASS (schema) | All current tables |
| Memberships / org units / permissions | MISSING | Flat role on `profiles` |
| Soft deletes | MISSING | Hard deletes |
| Audit / append-only time corrections | MISSING | `time_entries` mutable; `break_minutes` field only |
| Module configuration | MISSING | — |
| Subscriptions | MISSING | — |
| Schema vs demo store drift | PARTIAL | Demo mirrors types; live ops actions throw “not configured” |
| Destructive reset | N/A | No prod DB in worker; demo reseed can wipe `.data/demo-store.json` |

---

## 7. UI/UX audit

| Topic | Status |
|---|---|
| Consistency | PARTIAL — dark zinc theme, small UI kit |
| Dutch copy | PARTIAL — employer modules NL; some English (“Projects”, “Team”, “Sign out”) |
| Premium design system | FAIL vs master vision — functional, not brand-premium |
| Mobile employee flow | PARTIAL — clock + signature usable |
| Loading/empty/error states | PARTIAL — some searchParams flashes; incomplete |
| Accessibility | NOT TESTED |
| Cards overuse | PARTIAL — within existing system; keep for interaction containers |

---

## 8. Gap vs master specification (summary)

Approved scope phases 1–8 are **mostly incomplete**. Strongest areas: tenants/profiles/projects/time/photos schema, CRM/quotes/invoices demo, planning schedules, ops demo (assignments, fleet, tools, HR certs, work orders).

Excluded features (Workflow Automation Builder, AI Command Center, etc.) are correctly **absent**.

---

## 9. Prioritized repair plan

### P0 — before any production claim

1. Harden demo mode: **explicit opt-in only**; refuse in `NODE_ENV=production` unless `ALLOW_DEMO_IN_PRODUCTION=true`.
2. Plan/execute Next.js security upgrade path (breaking → requires controlled migration; document BLOCKED until approved if major bump).
3. Add health endpoint + refuse silent fallback to demo when env incomplete in production.
4. Introduce automated test harness + first tenant-isolation and money tests.
5. Document production gate: Supabase migrations applied, DEMO_MODE=false, HTTPS, backups.

### P1 — foundation (Phase 1)

1. Domain model expansion: memberships, permissions, module_configs, audit_events, time_entry_corrections, break_entries.
2. Integer/cent money type + migration strategy.
3. Wire ops modules to live Supabase (parity with demo).
4. Route middleware authorization helpers.
5. Design tokens / NL copy pass on shell.

### P2 — product modules (Phases 2–7)

Super Admin, org tree, leave, GPS private mode, materials, documents, portal, chat, PWA offline, integrations (adapters only without paid keys).

### P3 — polish

Performance, monitoring, premium visual system, internationalization prep.

---

## 10. Tests executed this audit

| Test | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run build` (prior ops commit) | PASS |
| `npm audit --omit=dev` | FAIL (critical/high on next/postcss) |
| HTTP smoke `/employer/projects`, `/fleet`, `/tools`, `/hr` | 200 |
| HTTP `/employee` with persona cookie | 200; clock UI present |
| Live Supabase tenant isolation | **NOT TESTED** (no Supabase project in worker) |
| Master acceptance suite (26 cases) | **NOT RUN** / mostly N/A |

---

## 11. Environment / blockers

| Item | Status |
|---|---|
| Demo mode local/live Hetzner | Works for UI demo |
| Supabase project credentials | Not configured for full live path in this worker (`DEMO_MODE=true`) |
| Redis / S3 / Maps / accounting APIs | Absent — adapters only until keys approved |
| Paid Next upgrade / infra | Ask before breaking major upgrades or paid services |

---

## 12. Immediate next actions (post-audit)

1. Commit audit documentation set.  
2. Implement P0 demo-mode production guard.  
3. Add Vitest (or Node test) foundation + first security/money tests.  
4. Expand schema for audit_events + time corrections (migration).  
5. Continue Phase 1 foundation without rebuilding working CRM/quote demo paths.

---

*This report states actual status only. “PASS” is reserved for proven, tested production behavior.*
