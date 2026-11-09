# TESTING

## Existing

- `npm run typecheck`
- `npm run lint`
- Manual HTTP smoke against demo

## Required (master prompt)

Introduce:

- Unit (Vitest): money, validation, demo gate, time calculations
- Integration: server actions against demo store + (later) Supabase
- E2E (Playwright): login, clock, quote, invoice, tenant isolation
- Security: RLS proofs, demo disabled in prod

## Required business cases

See master prompt §15 (26 cases). Track progress in BUILD_STATUS; none fully automated yet.
