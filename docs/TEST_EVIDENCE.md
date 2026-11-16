# Test Evidence — Ultimate Product V2

**Branch:** `cursor/nexora-ultimate-product-v2-5233`  
**Date:** 2026-11-16 (Europe/Amsterdam)

## Commands & results

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` | 81 passed |
| `PLAYWRIGHT_PORT=3004 npm run test:e2e` | 18 passed |
| `supabase/tests/v2_authz_regression.sql` | **not run** — BLOCKED (no test DB) |
| `npm run build` | not run in final pass (e2e uses next dev) |

## Notes

- Transient Playwright flake (`__webpack_require__.n`) resolved by clearing `.next`.
- Core-flow photo assertion uses `.first()` for duplicate Sam Jansen photos after re-upload.
