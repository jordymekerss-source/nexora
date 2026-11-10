# FOUNDATION GATE — Precondition for Enterprise Expansion

**Date:** 2026-11-11 (Europe/Amsterdam)  
**Branch baseline:** `cursor/nexora-critical-repair-5233` → work on `cursor/nexora-enterprise-phase1-5233`  
**Rule:** No large business modules may be marked complete until this gate is green.

## Gate checklist

| Criterion | Status | Evidence |
|---|---|---|
| App builds | **PASS** | `npm run build` on critical-repair |
| Unit/security policy tests | **PASS** | 28 Vitest tests |
| P0 auth metadata escalation fixed in repo | **PASS (code)** | `20251110000000_critical_repair_auth_time.sql` + signup-policy tests |
| P0 applied & proven on live Supabase | **GEBLOKKEERD** | No Supabase project in this worker |
| Multi-tenant A≠B PostgREST proven | **GEBLOKKEERD** | Same |
| Storage tenant isolation live-proven | **GEBLOKKEERD / PARTIAL code** | Policies in migrations; not live-tested |
| Demo ≠ production separation | **PASS (code)** | Explicit `NEXT_PUBLIC_DEMO_MODE`; fail-closed live env |
| Time/finance no known critical data-loss in demo path | **PARTIAL** | Corrections + atomic RPCs in repo; live path needs migration apply |
| Next.js critical advisories cleared | **FAIL / OPEN** | Still on 14.2.35 — upgrade decision required |

## Decision for this session

**Allowed:** Phase 1 architecture — module boundaries, entitlement registry, document/storage schema, accountant portal schema, specs, tests for pure logic.

**Not allowed yet as “complete modules”:** Full accounting UI, bank PSD2 connectors, Exact/Yuki live APIs, Peppol filing, offline PWA claims, OCR booking without human confirm.

**Honest product status:** NEXORA is a secured Core MVP foundation **in repository**, not a production ERP, until live RLS proof + HTTPS + Next upgrade + applied migrations.
