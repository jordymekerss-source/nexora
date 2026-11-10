# REQUIREMENTS_TRACEABILITY

Labels: **BESTAAND EN BEWEZEN** | **BESTAAND MAAR ONVOLLEDIG** | **ONTBREEKT** | **GEBLOKKEERD DOOR EXTERNE INTEGRATIE** | **NOG TE VALIDEREN**

## Foundation & security

| ID | Requirement | Status | DB | Backend | Frontend | Authz | Tests |
|---|---|---|---|---|---|---|---|
| F-01 | Secure sessions / SSR cookies | BESTAAND MAAR ONVOLLEDIG | Auth | middleware | login | yes | unit partial |
| F-02 | No privilege via user_metadata | BESTAAND MAAR ONVOLLEDIG | migration | signup actions | — | yes | signup-policy |
| F-03 | Super-admin invite ledger | BESTAAND MAAR ONVOLLEDIG | tenant_invites | ops | ops UI | service role | unit |
| F-04 | Multi-tenant RLS A≠B | NOG TE VALIDEREN / GEBLOKKEERD | RLS | — | — | RLS | live blocked |
| F-05 | Demo ≠ production | BESTAAND EN BEWEZEN (code) | demo store | runtime | banners | fail-closed | demo-mode |
| F-06 | Feature entitlements | BESTAAND MAAR ONVOLLEDIG | module_configs | assertModule | nav | yes | entitlements |
| F-07 | Central DMS | ONTBREEKT→Phase1 | documents_* | storage svc | TBD | RLS | storage-policy |
| F-08 | Accountant portal | ONTBREEKT→Phase1 | accountant_* | services | TBD | RLS | unit |
| F-09 | Audit logs | BESTAAND MAAR ONVOLLEDIG | audit_logs | writeAudit | ops | RLS | partial |
| F-10 | Live Next advisory clear | ONTBREEKT | — | upgrade | — | — | — |

## Module 1 — Accounting

| ID | Requirement | Status |
|---|---|---|
| A-01 | Sales invoices create/list/PDF | BESTAAND MAAR ONVOLLEDIG |
| A-02 | Invoice from quote/project/hours | ONTBREEKT |
| A-03 | Installments / partial pay / credit / correction | ONTBREEKT |
| A-04 | Reminders automation | ONTBREEKT |
| A-05 | UBL / Peppol | GEBLOKKEERD DOOR EXTERNE INTEGRATIE |
| A-06 | Purchase invoices + approval | ONTBREEKT |
| A-07 | OCR with human confirm | ONTBREEKT |
| A-08 | AR/AP ageing | ONTBREEKT |
| A-09 | Financial reports (P&L, VAT, cash) | ONTBREEKT |
| A-10 | Bank PSD2 import/match | GEBLOKKEERD DOOR EXTERNE INTEGRATIE |
| A-11 | Exact/Yuki/AFAS/SnelStart | GEBLOKKEERD DOOR EXTERNE INTEGRATIE |
| A-12 | VAT period close / year end workflow | ONTBREEKT |
| A-13 | Exact cents + immutable postings | BESTAAND MAAR ONVOLLEDIG (helpers; DB still numeric euros) |
| A-14 | Accountant period pack + portal | ONTBREEKT→Phase1 schema |

## Module 2 — Calculations & quotes

| ID | Status |
|---|---|
| C-01 Material/labor calc engine | ONTBREEKT |
| C-02 Margin vs markup clarity | ONTBREEKT |
| C-03 Templates + versions | ONTBREEKT |
| C-04 Quote variants / accept / PDF | BESTAAND MAAR ONVOLLEDIG (basic quotes) |
| C-05 Quote → project/planning/WO/PO | ONTBREEKT |
| C-06 Budget vs actual | ONTBREEKT |

## Module 3 — Planning

| ID | Status |
|---|---|
| P-01 Day/week/month boards | BESTAAND MAAR ONVOLLEDIG (list + assign) |
| P-02 Drag-drop reschedule | ONTBREEKT |
| P-03 Capacity / overload | ONTBREEKT |
| P-04 Conflict detection | ONTBREEKT |
| P-05 Realtime concurrent edit | ONTBREEKT |
| P-06 Route optimization | GEBLOKKEERD DOOR EXTERNE INTEGRATIE |

## Module 4 — Field service / work orders

| ID | Status |
|---|---|
| W-01 Work order CRUD/status | BESTAAND MAAR ONVOLLEDIG |
| W-02 Mobile employee day flow | BESTAAND MAAR ONVOLLEDIG |
| W-03 Digital signature (simple, not QES) | BESTAAND MAAR ONVOLLEDIG |
| W-04 Offline-first PWA | ONTBREEKT |

## Module 5 — Maintenance

| ID | Status |
|---|---|---|
| M-01..M-05 Contracts, assets, schedules, tickets, reports | ONTBREEKT |

## Module 6 — Inventory / procurement

| ID | Status |
|---|---|
| I-01..I-07 Articles, locations, movements, PO, wholesale, barcode, reorder | ONTBREEKT / wholesale GEBLOKKEERD |

## Module 7 — CRM

| ID | Status |
|---|---|
| R-01 Clients / contacts | BESTAAND MAAR ONVOLLEDIG |
| R-02 Full dossier cross-links | ONTBREEKT |
| R-03 Pipeline / leads | ONTBREEKT |
| R-04 Customer portal | ONTBREEKT (excluded separate app; optional tenant portal later) |

## Module 8 — Quality / safety

| ID | Status |
|---|---|
| Q-01..Q-05 Checklists, VCA, inspections, incidents, CAPA | ONTBREEKT |

## Accountant portal (extra)

| ID | Status |
|---|---|
| AP-01 Collect period artefacts | ONTBREEKT→Phase1 tables |
| AP-02 Completeness checks | ONTBREEKT→Phase1 service stubs |
| AP-03 Period statuses | ONTBREEKT→Phase1 |
| AP-04 Export package | ONTBREEKT |
| AP-05 Accountant multi-client ACL | ONTBREEKT→Phase1 grants |
| AP-06 Bookkeeping software sync | GEBLOKKEERD DOOR EXTERNE INTEGRATIE |
