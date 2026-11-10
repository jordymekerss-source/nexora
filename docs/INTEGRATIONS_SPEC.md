# INTEGRATIONS_SPEC

Adapter pattern under `src/modules/integrations`.

| Connector | Status |
|---|---|
| Exact Online | Designed only — GEBLOKKEERD without OAuth app |
| Yuki | Designed only |
| AFAS | Designed only |
| SnelStart | Designed only |
| PSD2 bank | Designed only |
| Peppol/UBL | Designed only |
| Maps/routing | Designed only |
| Wholesale EDI | Designed only |

No fake live sync. Adapters expose `capabilities()` and throw `IntegrationNotConfiguredError` until credentials exist.
