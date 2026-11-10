# MODULE_ARCHITECTURE

## Physical layout

```
src/modules/<module>/
  index.ts                 # public module API (only export surface)
  services/                # domain services (server-only)
  types.ts                 # module types
```

Cross-module writes go through exported services or domain events — not by importing another module’s internal tables ad hoc from UI pages.

Existing App Router pages remain the HTTP/UI layer and call module services.

## Module map

| Module dir | Owns (target) | Current |
|---|---|---|
| `entitlements` | module/feature flags, limits | Partial |
| `documents` | DMS metadata, quotas, signed uploads | Phase 1 schema |
| `crm` | clients, contacts, opportunities | Partial (clients) |
| `quotations` | quotes/items | Partial |
| `calculations` | calc sheets, templates | Missing |
| `planning` | schedules, capacity | Partial |
| `field-service` / `work-orders` | work orders, signatures | Partial |
| `maintenance` | contracts, assets, tickets | Missing |
| `procurement` / `inventory` | PO, stock | Missing |
| `accounting` / `finance` | AR/AP, periods, exports | Partial sales invoices |
| `accountant` | accountant access + period packs | Phase 1 schema |
| `quality` / `safety` | checklists, incidents | Missing |
| `integrations` | connectors/adapters | Stubs only |

## Events (outbox — Phase 1 table)

`customer.created`, `quote.accepted`, `project.created`, `work_order.completed`, `time_entry.approved`, `invoice.created`, `payment.matched`, `maintenance.due`, `document.uploaded`, `accounting_period.handed_over`
