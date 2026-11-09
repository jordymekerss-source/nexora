# DECISIONS

| Date | Decision | Rationale |
|---|---|---|
| 2026-11 | Use Supabase SQL + RLS instead of Prisma initially | Fits Auth/Storage; typed client present |
| 2026-11 | File-backed demo store for zero-config demos | Enables Hetzner demo without Supabase |
| 2026-11-09 | Audit-first before rebuilding modules | Master prompt mandate; avoid duplicate work |
| 2026-11-09 | Keep working CRM/quotes/invoices demo paths | Spec: retain correct existing features |
| 2026-11-09 | Flag Next 16 upgrade as controlled decision | `npm audit fix --force` is breaking |
| 2026-11-09 | Demo mode must be explicit opt-in | Prevent accidental unauthenticated “prod” |
