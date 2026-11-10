# TEST_STRATEGY

## Layers

1. **Unit** — Vitest: money, auth policy, entitlements, upload policy, accountant completeness, adapters  
2. **Database / RLS** — SQL fixtures against local/remote Supabase (blocked without project)  
3. **API / Server Actions** — authz + entitlement denial  
4. **E2E** — Playwright (planned)  
5. **Offline sync** — when field-service PWA lands  
6. **Financial arithmetic** — cents helpers + invoice totals  
7. **Upload** — MIME/magic/quota (Phase 1 unit coverage)  
8. **Integration mocks** — adapters throw when unconfigured  

## Gate rule

No module marked complete without: workflow test, RLS/tenant test, authz test, error-path test, docs aligned.

## Current suite

Run: `npm test`  
Phase 1 adds: upload-policy, accountant completeness, integration adapter stubs.
