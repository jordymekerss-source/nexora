# Tenant isolation live checklist

Use two tenants (A/B), employer+employee JWTs each.

- [ ] A employee cannot `select` B projects
- [ ] A employer cannot `select` B invoices
- [ ] A cannot insert schedule with B project_id (trigger)
- [ ] A cannot insert quote with B client_id (trigger)
- [ ] A cannot insert invoice with B project_id (trigger)
- [ ] A employee cannot update approved time entry
- [ ] A user cannot update own `profiles.role` / `tenant_id`
- [ ] Storage select for A employee cannot list B objects

Mark each with PASS/FAIL and attach request/response evidence.
