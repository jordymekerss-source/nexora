import { describe, expect, it } from "vitest";
import { authorize } from "@/lib/authorization/authorize";
import type { SessionPermissionContext } from "@/lib/permissions/types";

function employer(): SessionPermissionContext {
  return {
    userId: "u1",
    tenantId: "t1",
    role: "employer",
    enabledModules: ["time", "billing", "projects"],
    enabledFeatures: [],
    actionPermissions: new Map(),
    dataScopes: [],
    supportGrant: null,
  };
}

describe("authorize()", () => {
  it("denies unauthenticated actors", () => {
    expect(authorize(null, { moduleKey: "time" }, "view").allowed).toBe(false);
  });

  it("denies cross-tenant resource references", () => {
    const decision = authorize(
      employer(),
      { moduleKey: "time", resourceTenantId: "other" },
      "view",
    );
    expect(decision.code).toBe("tenant_mismatch");
  });

  it("denies super_admin without support grant on tenant modules", () => {
    const actor: SessionPermissionContext = {
      ...employer(),
      role: "super_admin",
      supportGrant: null,
    };
    expect(authorize(actor, { moduleKey: "billing" }, "view").code).toBe(
      "super_admin_no_grant",
    );
  });

  it("allows employer time create", () => {
    expect(authorize(employer(), { moduleKey: "time" }, "create").allowed).toBe(true);
  });

  it("denies employee project access without datascope", () => {
    const actor: SessionPermissionContext = {
      ...employer(),
      role: "employee",
      dataScopes: [{ scopeType: "project", scopeId: "a", accessLevel: "write" }],
    };
    const decision = authorize(
      actor,
      { moduleKey: "projects", scopeType: "project", scopeId: "b" },
      "view",
    );
    expect(decision.code).toBe("scope_denied");
  });
});
