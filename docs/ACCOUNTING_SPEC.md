# ACCOUNTING_SPEC

## Scope

Sales AR, purchase AP, VAT overviews, period close, bank matching (PSD2 adapter), bookkeeping connectors, accountant handover.

## Implemented now

- Sales invoices + lines + payments (demo + schema)
- Atomic convert quote→invoice / time→invoice RPCs (migration present)
- Money helpers in cents (application layer)

## Not implemented

Installments, credit/correction invoices, UBL/Peppol, purchase invoices, OCR, ageing reports, PSD2, Exact/Yuki/AFAS/SnelStart live APIs, automated tax filing.

## Rules

- No float for bookkeeping math.
- Final postings immutable; use correction entries.
- Idempotency keys on create/convert.
- Never claim official BTW-aangifte without legal/ops readiness.

## Phase plan

Fase 4 of master order. Schema stubs for periods/packs in Fase 1 (`accounting_periods`, `accounting_period_packs`).
