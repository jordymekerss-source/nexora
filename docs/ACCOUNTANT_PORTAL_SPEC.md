# ACCOUNTANT_PORTAL_SPEC

## Goal

Entrepreneurs prepare period administrations in NEXORA and hand over a sealed pack to an invited accountant.

## Phase 1 delivered

- Schema: `accountant_access_grants`, `accounting_periods`, `accounting_period_packs`, `accounting_period_notes`, `accountant_access_audit`
- Role `accountant` (tenant_id null; multi-client via grants)
- Completeness evaluator (critical/warning/info) — pure service + tests
- Period status transition rules
- Module + feature keys: `accountant`, `accountant.portal`, `accountant.export_pack`

## Not yet

- UI for invite / portal inbox
- ZIP/UBL/CSV export pack generator
- Live bookkeeping connectors
- Automatic fiscal approval claims (never)

## Tenant isolation rule

Accountant sees **only** `client_tenant_id` rows with `status = active` grant. No implicit access to sibling companies.
