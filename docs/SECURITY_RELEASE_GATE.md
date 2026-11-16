# Security Release Gate

Geen productie-deploy zonder alle onderstaande checks.

## Must-pass

1. Module entitlements fail-closed (lege expliciete config ≠ defaults).
2. Deny-by-default permissions op server actions.
3. RLS: Tenant A kan Tenant B niet lezen/schrijven (echte DB-test).
4. Demo-persona cookie nooit productiebewijs; ongeldige persona ≠ escalatie.
5. Geen service-role keys in browser.
6. Geen privilege via signup metadata.
7. Storage object paths tenant-gebonden.
8. Dependency advisories beoordeeld; geen `npm audit fix --force`.
9. Super Admin alleen tijdelijk, gelogd, intrekbaar.

## Huidige status (2026-11-16 Europe/Amsterdam)

| Gate | Status |
| --- | --- |
| Entitlements fail-closed | Code gefixt; unit tests toegevoegd |
| Permissions model | Scaffold + migratie aanwezig; niet overal afgedwongen |
| RLS multi-tenant proof | **BLOCKED** — geen live Supabase testdb |
| Demo persona hardening | Code gefixt |
| Dependency upgrade Next | Beoordeling open (14.2.35) |
| Super Admin JIT | Ontwerp; niet productieklaar |

**Conclusie:** NOT READY FOR PRODUCTION.
