# MASTER_PRODUCT_SPEC — NEXORA Business OS

**Tagline:** Run your business. Build better.  
**Market:** Netherlands first.  
**Form:** Modular multi-tenant SaaS Business Operating System.

## Product intent

One integrated platform covering:

1. Accounting & finance  
2. Calculations & quotations  
3. Project planning / board  
4. Work orders & field service  
5. Maintenance / service contracts  
6. Procurement & inventory  
7. CRM  
8. Quality & safety (VCA/KAM)  
9. Accountant portal & period handover  
10. Central documents/storage & entitlements  

Not eight separate apps. One data model with controlled module boundaries.

## Architecture principles

- Modular monolith (Next.js + Supabase Postgres RLS)
- Server-side authz + entitlements + RLS
- Exact money (integer cents / numeric) — no float bookkeeping
- No fake integrations or compliance claims
- Feature entitlements per tenant
- Private object storage with signed URLs
- Outbox events for cross-module workflows

## Current reality (2026-11-11)

| Area | Label |
|---|---|
| Auth / tenancy / demo gate | BESTAAND MAAR ONVOLLEDIG (live proof blocked) |
| CRM / quotes / invoices / planning (demo) | BESTAAND MAAR ONVOLLEDIG |
| Time / breaks / corrections (demo) | BESTAAND MAAR ONVOLLEDIG |
| Fleet / tools / HR certs / work-order sign | BESTAAND MAAR ONVOLLEDIG |
| Full accounting / banks / Peppol | ONTBREEKT |
| Calculation engine | ONTBREEKT |
| Visual plan board DnD | ONTBREEKT |
| Offline PWA | ONTBREEKT |
| Inventory / procurement | ONTBREEKT |
| Maintenance contracts | ONTBREEKT |
| Quality/safety platform | ONTBREEKT |
| Central DMS | ONTBREEKT → Phase 1 schema started |
| Accountant portal | ONTBREEKT → Phase 1 schema started |
| Entitlements | BESTAAND MAAR ONVOLLEDIG → expanded registry |

## Delivery order

See master prompt §19. This session executes **Fase 1 — Fundament** only.
