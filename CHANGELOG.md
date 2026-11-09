# CHANGELOG

## Unreleased

### Critical repair (auth/time/billing)

- Public signup ignores privileged metadata; membership via `tenant_invites` only
- Employer elevation only through create-organization (service role)
- Time entry employee updates blocked for approved rows (RLS + trigger)
- Atomic billing RPCs for quote create/convert; safer invoice numbering
- Repair/security/tenant isolation test reports

### Core MVP stabilisation

- Live middleware route protection; fail-closed live env without Supabase
- Employer-only public signup; invite-only employees
- Server-side module entitlements on key actions
- Cent-backed VAT/line money math; document sequence SQL helper
- Employer time corrections with append-only history (demo)
- Storage employee SELECT tightened; security audit docs refreshed

### Audit & foundation

- Master audit + requirements matrix
- Demo-mode production hardening and Vitest harness
- Foundation + security hardening migrations

## 2026-11-09 — Ops modules (prior)

- Multi-user `project_assignments`, employee clock-in, fleet/tools/HR, work-order signatures (demo)
- Branch: `cursor/nexora-ops-modules-5233`

## 2026-11-09 — CRM / planning demo

- Clients, quotes, invoices, planning, file-backed demo store

## Earlier

- Core MVP: tenants, profiles, projects, time, photos, team invite
