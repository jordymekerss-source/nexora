import { describe, expect, it } from "vitest";
import {
  canPerform,
  defaultActionPermissionForRole,
  hasDataAccess,
  resolveActionPermission,
} from "@/lib/permissions/evaluate";
import type { SessionPermissionContext } from "@/lib/permissions/types";

function baseCtx(
  overrides: Partial<SessionPermissionContext> = {},
): SessionPermissionContext {
  return {
    userId: "u1",
    tenantId: "t1",
    role: "employee",
    enabledModules: ["time", "projects", "billing", "documents"],
    enabledFeatures: [],
    actionPermissions: new Map(),
    dataScopes: [],
    ...overrides,
  };
}

describe("permission evaluation", () => {
  it("denies employee approve on time by default", () => {
    const ctx = baseCtx();
    expect(canPerform(ctx, "time", "canApprove")).toBe(false);
    expect(canPerform(ctx, "time", "canCreate")).toBe(true);
  });

  it("employer can approve and manage billing", () => {
    const ctx = baseCtx({ role: "employer" });
    expect(canPerform(ctx, "billing", "canApprove")).toBe(true);
    expect(canPerform(ctx, "billing", "canManage")).toBe(true);
  });

  it("honors Layer-3 override that removes create", () => {
    const ctx = baseCtx({
      actionPermissions: new Map([
        [
          "time",
          {
            canView: true,
            canCreate: false,
            canEdit: false,
            canDelete: false,
            canApprove: false,
            canExport: false,
            canManage: false,
          },
        ],
      ]),
    });
    expect(resolveActionPermission(ctx, "time").canCreate).toBe(false);
  });

  it("blocks disabled modules for employees", () => {
    const ctx = baseCtx({ enabledModules: ["projects"] });
    expect(canPerform(ctx, "billing", "canView")).toBe(false);
  });

  it("accountant defaults to finance read/export only", () => {
    const perm = defaultActionPermissionForRole("accountant", "billing");
    expect(perm.canView).toBe(true);
    expect(perm.canExport).toBe(true);
    expect(perm.canCreate).toBe(false);
  });

  it("enforces Layer-4 finance deny for employees without scope", () => {
    const ctx = baseCtx();
    expect(hasDataAccess(ctx, "finance", null, "read")).toBe(false);
  });

  it("allows project read via all_projects scope", () => {
    const ctx = baseCtx({
      dataScopes: [{ scopeType: "all_projects", scopeId: null, accessLevel: "read" }],
    });
    expect(hasDataAccess(ctx, "project", "p1", "read")).toBe(true);
    expect(hasDataAccess(ctx, "project", "p1", "manage")).toBe(false);
  });
});
