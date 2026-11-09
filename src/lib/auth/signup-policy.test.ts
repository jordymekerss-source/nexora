import { describe, expect, it } from "vitest";
import { resolveSignupBootstrap } from "@/lib/auth/signup-policy";

describe("signup privilege policy", () => {
  it("rejects super_admin metadata", () => {
    expect(
      resolveSignupBootstrap({
        rawRole: "super_admin",
        rawTenantId: "11111111-1111-4111-8111-111111111111",
        invitedAt: null,
        email: "attacker@example.com",
        openInviteTenantId: null,
      }),
    ).toEqual({ role: "employee", tenantId: null });
  });

  it("rejects employer + arbitrary tenant metadata", () => {
    expect(
      resolveSignupBootstrap({
        rawRole: "employer",
        rawTenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invitedAt: null,
        email: "attacker@example.com",
        openInviteTenantId: null,
      }),
    ).toEqual({ role: "employee", tenantId: null });
  });

  it("rejects employee + arbitrary tenant without invite ledger", () => {
    expect(
      resolveSignupBootstrap({
        rawRole: "employee",
        rawTenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        invitedAt: null,
        email: "attacker@example.com",
        openInviteTenantId: null,
      }),
    ).toEqual({ role: "employee", tenantId: null });
  });

  it("allows normal public registration as unprivileged employee", () => {
    expect(
      resolveSignupBootstrap({
        rawRole: null,
        rawTenantId: null,
        invitedAt: null,
        email: "owner@example.com",
        openInviteTenantId: null,
      }),
    ).toEqual({ role: "employee", tenantId: null });
  });

  it("binds invited employee to invite ledger tenant only", () => {
    expect(
      resolveSignupBootstrap({
        rawRole: "super_admin",
        rawTenantId: "evil-tenant",
        invitedAt: "2026-11-09T00:00:00.000Z",
        email: "worker@example.com",
        openInviteTenantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    ).toEqual({
      role: "employee",
      tenantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });
});
