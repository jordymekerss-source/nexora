# NEXORA — Requirements Traceability Matrix

**Source:** Ultimate Master Audit, Repair & Build Prompt  
**Date:** 2026-11-09 (Europe/Amsterdam)  
**Statuses:** PASS | PARTIAL | FAIL | MISSING | NOT TESTED | BLOCKED  
**PASS rule:** Requires implementation evidence **and** executed tests. Almost no rows qualify as PASS yet.

Related: `docs/AUDIT_REPORT.md`

---

## Process / governance

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| GOV-001 | Audit before blind coding | P0 | PASS | This matrix + AUDIT_REPORT produced before Phase 1 expansion | Keep |
| GOV-002 | No fake functionality | P0 | PARTIAL | Demo labeled; some English leftovers; ops live path throws | Label + wire live |
| GOV-003 | No duplicate modules | P0 | PARTIAL | Dual project UIs (`/dashboard/projects` vs `/employer/projects`) | Consolidate |
| GOV-004 | Docs match reality | P0 | PARTIAL | Audit docs added; README still MVP-oriented | Update continuously |
| GOV-005 | Session handoff files | P0 | PARTIAL | Creating SESSION_HANDOFF / BUILD_STATUS | Maintain |
| GOV-006 | Ask before paid/irreversible scope | P0 | PASS | Policy followed (Next major bump flagged) | Keep |

---

## Architecture & platform

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| ARCH-001 | Next.js + React + TS + Tailwind | P1 | PARTIAL | Next 14.2.35 App Router | Upgrade security path |
| ARCH-002 | Modular monolith | P1 | PARTIAL | App actions by domain; no module packages | Formalize domains |
| ARCH-003 | PostgreSQL + migrations + RLS | P0 | PARTIAL | `supabase/migrations/*` RLS | Live isolation tests |
| ARCH-004 | Prisma or equivalent ORM | P2 | PARTIAL | Typed Supabase client | Keep unless Prisma needed |
| ARCH-005 | Redis + job queue | P2 | MISSING | — | Phase 6/1 jobs |
| ARCH-006 | S3-compatible storage + signed URLs | P1 | PARTIAL | Supabase Storage photos only | Extend |
| ARCH-007 | Docker / Compose / HTTPS / proxy | P1 | MISSING | Bare Node on :3000 | Phase 8 |
| ARCH-008 | Logging + monitoring + backups | P0 | MISSING | — | Phase 8 |
| ARCH-009 | Event-driven outbox | P2 | MISSING | — | Phase 6 |
| ARCH-010 | Separate env: dev/test/staging/prod | P1 | MISSING | Single demo env | Document + enforce |

---

## Multi-tenancy & security

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| TEN-001 | Tenant context server-side | P0 | PARTIAL | `require*Session` + `tenant_id` | Harden middleware |
| TEN-002 | PostgreSQL RLS | P0 | PARTIAL | Policies in SQL | NOT TESTED live |
| TEN-003 | Cross-tenant access impossible | P0 | NOT TESTED | No isolation suite | Write tests + live DB |
| TEN-004 | Tenant-bound files | P0 | PARTIAL | Photo storage policies | Extend to all blobs |
| TEN-005 | Tenant-bound jobs/exports | P1 | MISSING | — | Build |
| SEC-001 | Authentication | P0 | PARTIAL | Supabase Auth; demo gated | Keep hardening |
| SEC-002 | Session management | P0 | PARTIAL | Cookie SSR; callback redirect fixed | Middleware ACL next |
| SEC-003 | Password storage | P0 | PARTIAL | Delegated to Supabase | Verify config |
| SEC-004 | MFA | P2 | MISSING | — | Optional Phase 8 |
| SEC-005 | Granular permissions | P1 | MISSING | Role enum only | Phase 2 |
| SEC-006 | CSRF / XSS / SQLi / SSRF protections | P0 | PARTIAL | Open redirect fixed; deeper tests pending | Headers + tests |
| SEC-007 | Rate limiting | P1 | MISSING | — | Add |
| SEC-008 | Upload security | P1 | PARTIAL | Storage policies; signature data URLs weak | Harden |
| SEC-009 | Secrets management | P0 | PARTIAL | `.env.example`; no vault | Prod secrets process |
| SEC-010 | HTTPS | P0 | FAIL | Live HTTP :3000 | TLS via proxy |
| SEC-011 | Audit logging | P0 | PARTIAL | `audit_events` table + demo break events | Wire live writes |
| SEC-012 | Support access temporary + logged | P1 | MISSING | — | Phase 2 |
| SEC-013 | No hardcoded secrets | P0 | PARTIAL | Demo placeholders in public-env | Review |
| SEC-014 | Critical vuln remediation | P0 | FAIL | `npm audit` critical on Next | Upgrade plan |
| SEC-015 | Demo mode cannot activate accidentally in prod | P0 | PASS | Explicit opt-in + prod allow flag + tests | Keep |
| SEC-016 | Signup cannot self-assign super_admin | P0 | PASS | Hardened trigger (migration) | Apply on Supabase |
| SEC-017 | Signup cannot join arbitrary tenant | P0 | PASS | Invite-only tenant attach | Apply on Supabase |

---

## Accounts & organization

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| ACC-001 | Super Admin console | P1 | MISSING | Role exists in schema only | Phase 2 |
| ACC-002 | Company admin manages org | P1 | PARTIAL | Employer role | Expand |
| ACC-003 | Onboarding module selection | P1 | MISSING | — | Phase 2 |
| ACC-004 | Activate/deactivate modules | P1 | MISSING | — | `module_configs` |
| ORG-001 | Interactive org tree | P1 | MISSING | — | Phase 2 |
| ORG-002 | Teams / departments | P1 | MISSING | Team page = invite list | Build |
| ORG-003 | Drag-drop / search / history | P2 | MISSING | — | Phase 2 |
| ORG-004 | Lazy load 50+ employees | P2 | MISSING | — | When tree exists |

---

## HR & personnel

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| HR-001 | Add/invite employees | P1 | PARTIAL | Invite action + demo profiles | Live test |
| HR-002 | Profiles / contacts | P1 | PARTIAL | `profiles` | Expand |
| HR-003 | Documents | P2 | MISSING | — | Phase 5 |
| HR-004 | Roles & permissions | P1 | PARTIAL | Coarse roles | Granular RBAC |
| HR-005 | Leave requests | P1 | MISSING | — | Phase 3 |
| HR-006 | Sick reporting | P1 | MISSING | — | Phase 3 |
| HR-007 | Leave balances | P1 | MISSING | — | Phase 3 |
| HR-008 | Certificates + expiry warnings | P1 | PARTIAL | HR page demo + SQL | Live wire |
| HR-009 | Training | P2 | MISSING | — | Later |
| HR-010 | Reminders | P2 | MISSING | — | Notifications |

---

## Planning

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| PLAN-001 | Day/week/month views | P1 | PARTIAL | Week-ish planning page | Expand |
| PLAN-002 | Employee/team/project planning | P1 | PARTIAL | `project_schedules` | Expand |
| PLAN-003 | Conflict detection | P2 | MISSING | — | Build |
| PLAN-004 | Travel time / routing | P2 | MISSING | Needs Maps keys | Adapter + BLOCKED keys |
| PLAN-005 | Reminders | P2 | MISSING | — | Events |

---

## Projects & work orders

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| PRJ-001 | Create projects + client link | P1 | PARTIAL | Projects + clients | Keep |
| PRJ-002 | Multi-user assignment | P1 | PARTIAL | `project_assignments` demo | Live wire |
| PRJ-003 | Status / progress / tasks | P1 | PARTIAL | Status enum only; no tasks | Build tasks |
| PRJ-004 | Digital work orders + signature | P1 | PARTIAL | SignaturePad demo | Secure storage |
| PRJ-005 | Extra work (meerwerk) | P2 | MISSING | — | Phase 3 |
| PRJ-006 | Project documents / dossier | P2 | MISSING | Photos only | Phase 5 |
| PRJ-007 | Budget vs actual | P2 | MISSING | — | Phase 3 |

---

## Time clock

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| TIME-001 | Clock in/out | P0 | PARTIAL | Employee + dashboard | Live parity |
| TIME-002 | Break start/stop (not fictional) | P0 | PARTIAL | Demo `break_entries` + employee start/stop; live path pending | Wire Supabase |
| TIME-003 | Travel time | P1 | MISSING | — | Build |
| TIME-004 | Overtime rules configurable | P1 | MISSING | — | CAO config |
| TIME-005 | Approvals | P1 | PARTIAL | pending/approved | Keep expand |
| TIME-006 | Corrections append-only | P0 | MISSING | Mutable rows | Corrections table |
| TIME-007 | Retain originals | P0 | MISSING | — | Audit trail |
| TIME-008 | Exports | P1 | MISSING | — | Build |
| TIME-009 | Offline clock | P0 | MISSING | No PWA | Phase 7 |
| TIME-010 | Shared multi-user same project | P1 | PARTIAL | Demo works | Live test |

---

## GPS

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| GPS-001 | Project locations / geofence | P1 | MISSING | Address text only | Phase 3 |
| GPS-002 | Clock location check | P1 | MISSING | — | Phase 3 |
| GPS-003 | Private mode (no server coords) | P0 | MISSING | — | Phase 3 |
| GPS-004 | Maps / Waze deep links | P2 | MISSING | — | Adapters |
| GPS-005 | AVG transparency | P0 | MISSING | — | PRIVACY doc + UI |

---

## Photos & diary

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| PHOTO-001 | Upload with metadata | P1 | PARTIAL | Project photos live path | Demo gap |
| PHOTO-002 | Client-side compress 1080p WebP | P2 | MISSING | — | Build |
| PHOTO-003 | Thumbnails + signed URLs | P1 | PARTIAL | Signed URLs | Thumbnails |
| PHOTO-004 | Damage / issues / share selection | P2 | MISSING | — | Expand |

---

## Materials & inventory

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| MAT-001 | Materials on projects | P1 | MISSING | — | Phase 4 |
| MAT-002 | Inventory / suppliers / PO | P2 | MISSING | Contact-for-advanced OK | Adapters |
| TOOL-001 | Tools checkout | P1 | PARTIAL | Tools demo | Live wire |
| FLEET-001 | Vehicles APK km | P1 | PARTIAL | Fleet demo | Live wire |
| FLEET-002 | Maintenance / damage / QR | P2 | MISSING | — | Expand |
| FLEET-003 | Telematics integrations | P3 | MISSING | No hardware claim | Adapters later |

---

## Billing & CRM

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| CRM-001 | Clients + history | P1 | PARTIAL | Clients UI | Expand |
| CRM-002 | Customer portal | P1 | MISSING | — | Phase 5 |
| CRM-003 | Appointments portal | P2 | MISSING | — | Phase 5 |
| CRM-004 | Feedback / CSAT | P2 | MISSING | — | Phase 5 |
| QUO-001 | Quotes + accept | P1 | PARTIAL | Quote builder | Digital accept expand |
| INV-001 | Invoices from hours | P1 | PARTIAL | Generate + print | Keep |
| INV-002 | Materials / meerwerk on invoice | P2 | MISSING | Hours-focused | Expand |
| INV-003 | Accounting exports Exact/SnelStart/Twinfield | P2 | MISSING | — | Adapters |
| INV-004 | UBL / Peppol | P2 | MISSING | — | Adapters |
| FIN-001 | Exact money (no float) | P0 | FAIL | `money.ts` float | Cents migration |

---

## Documents, comms, quality, expenses

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| DOC-001 | Foldered docs + ACL + versions | P1 | MISSING | — | Phase 5 |
| DOC-002 | Digital contracts + e-sign | P1 | PARTIAL | Work-order sign only | Expand |
| COM-001 | Internal chat | P2 | MISSING | — | Phase 6 |
| COM-002 | Notifications | P1 | MISSING | — | Phase 6 |
| QLT-001 | Checklists / incidents | P2 | MISSING | — | Phase 4 |
| EXP-001 | Expenses + receipts | P1 | MISSING | — | Phase 4 |

---

## Employee app & PWA

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| EMP-001 | Personal day / agenda / tasks | P1 | PARTIAL | Clock-focused `/employee` | Expand |
| EMP-002 | NL language UI | P1 | PARTIAL | Mostly NL | Complete |
| PWA-001 | Service worker + offline clock | P0 | MISSING | — | Phase 7 |
| PWA-002 | IndexedDB sync queue idempotent | P0 | MISSING | — | Phase 7 |
| PWA-003 | Sync status UI | P1 | MISSING | — | Phase 7 |
| PWA-004 | Offline work order + photos | P1 | MISSING | — | Phase 7 |

---

## Design & UX

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| UX-001 | Premium design system | P2 | FAIL | Minimal zinc kit | Redesign pass |
| UX-002 | Employer dashboard widgets | P1 | PARTIAL | Basic dashboard | Expand |
| UX-003 | Loading/empty/error/success states | P1 | PARTIAL | Inconsistent | Standardize |
| UX-004 | Responsive mobile | P1 | PARTIAL | Employee OK; employer dense | Improve |
| UX-005 | No dummy data masquerading as prod | P0 | PARTIAL | Demo mode seed | Hard gate demo |

---

## Testing & acceptance

| ID | Requirement | Priority | Status | Evidence | Action |
|---|---|---|---|---|---|
| QA-001 | Unit/integration/e2e frameworks | P0 | MISSING | No test runner | Add Vitest + Playwright |
| QA-002 | Required cases 1–26 | P0 | MISSING | Not implemented | Build progressively |
| QA-003 | Regression after changes | P0 | MISSING | Manual only | Automate |
| QA-004 | Security tests | P0 | MISSING | npm audit only | Add |
| ACC-PROD-001 | Production acceptance checklist | P0 | FAIL | Not met | Track in BUILD_STATUS |

---

## Explicitly excluded (must remain absent)

| ID | Item | Status |
|---|---|---|
| EXCL-001 | Workflow Automation Builder | ABSENT (correct) |
| EXCL-002 | AI Command Center | ABSENT (correct) |
| EXCL-003 | Business Health Score | ABSENT (correct) |
| EXCL-004 | Separate customer native app | ABSENT (correct) |
| EXCL-005 | Digital knowledge base | ABSENT (correct) |
| EXCL-006 | Smart Project Calculations | ABSENT (correct) |

---

## Coverage counts (approx.)

| Status | Count (this matrix) |
|---|---|
| PASS | 2 |
| PARTIAL | ~55 |
| FAIL | ~8 |
| MISSING | ~50 |
| NOT TESTED | 2 |
| BLOCKED | 0 (Next upgrade flagged for decision) |

*Counts are indicative; treat each row as authoritative.*
