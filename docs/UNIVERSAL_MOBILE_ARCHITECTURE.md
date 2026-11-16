# UNIVERSAL MOBILE ARCHITECTURE — NEXORA

**Date:** 2026-11-11 (Europe/Amsterdam)  
**Status:** Architecture decision — implementation not started as a store app yet.

## Decision

One **React Native + Expo** application for iOS and Android.

- Single App Store / Play Store binary.
- No separate employer / employee / admin apps.
- After login, the UI is composed from the **session permission context** (four layers).
- Reuse the existing Supabase Auth, Postgres RLS, Server Actions / future mobile API, and entitlement registry.
- Keep Next.js App Router for desktop-heavy workflows (CRM, invoices, planning boards).

## Why Expo

| Criterion | Assessment |
|---|---|
| Shared TS with web domain types | Strong |
| OTA updates for non-native changes | Available (policy-controlled) |
| Offline / SecureStore / FileSystem | Mature |
| Camera, push, background fetch | Supported with known iOS limits |
| Rewrite Next.js UI | **Not required** — mobile is a new client |

## High-level components

```
nexora-mobile/          (future package / app)
  app/                  Expo Router screens
  src/session/          fetchSessionContext()
  src/permissions/      shared evaluate() (mirror src/lib/permissions)
  src/offline/          queue, Indexed-like SQLite, sync
  src/api/              Supabase client + RPC wrappers
```

Shared pure logic to extract into a future `packages/nexora-domain` (optional later):
- money-cents
- permission evaluate
- signup policy
- upload policy validators

## Login → dynamic shell

1. Auth (email/password or magic link via Supabase).
2. Load profile + tenant.
3. Load `module_configs` + `feature_entitlements`.
4. Load Layer-3 `user_action_permissions` + Layer-4 `user_data_scopes`.
5. Build navigation tree: only modules with `canView` and company entitlement.
6. Deep links resolve against the same checks server-side.

## Role examples (not hardcoded product limits)

- Employee: Mijn werkdag, uren, pauzes, werkbonnen, foto’s, vakantie, toegewezen projecten.
- Employer: Overzicht, team, planning, CRM, offertes, facturen, rapportages.
- Accountant: Toegewezen periodes, documenten, export (via grants).
- Project lead: projects + planning + work orders when Layer-3 grants allow.

## Backend authorization

Mobile never trusts hidden tabs. Every mutation uses:
- Supabase RLS, and/or
- SECURITY DEFINER RPCs with `current_tenant_id()` checks, and/or
- Next.js route handlers / server actions with `assertModuleEnabled` + `canPerform`.

Permission revocation: online requests re-read permissions each request (or short TTL cache ≤ 60s). Offline: see `OFFLINE_SYNC_ARCHITECTURE.md`.

## Delivery phases

1. Architecture + permission tables (this session foundation).
2. Expo app skeleton + session bootstrap.
3. Employee day flow (clock, break, photos) online.
4. Offline queue for time/photos/work orders.
5. Employer read-only mobile dashboards.
6. Store submission (icons, privacy labels, GPS disclosure).

## Explicit non-goals now

- Shipping a store binary in this session.
- Separate white-label apps per customer.
- Claiming QES signatures or certified payroll.
