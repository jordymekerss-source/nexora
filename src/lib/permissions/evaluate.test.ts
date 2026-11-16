import { describe, expect, it } from "vitest";
import {
  canPerform,
  defaultActionPermissionForRole,
  hasDataAccess,
  isSupportGrantActive,
  resolveActionPermission,
} from "@/lib/permissions/evaluate";
import type { SessionPermissionContext, SupportGrant } from "@/lib/permissions/types";

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
    supportGrant: null,
    ...overrides,
  };
}

const activeGrant = (overrides: Partial<SupportGrant> = {}): SupportGrant => ({
  tenantId: "t1",
  reason: "ticket-1",
  scopes: ["*"],
  startsAt: new Date(Date.now() - 60_000).toISOString(),
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  revokedAt: null,
  ...overrides,
});

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

  it("never grants project B because employee has project A", () => {
    const ctx = baseCtx({
      dataScopes: [{ scopeType: "project", scopeId: "project-a", accessLevel: "write" }],
    });
    expect(hasDataAccess(ctx, "project", "project-a", "read")).toBe(true);
    expect(hasDataAccess(ctx, "project", "project-b", "read")).toBe(false);
  });

  it("denies employee generic read without explicit scope", () => {
    const ctx = baseCtx({ dataScopes: [] });
    expect(hasDataAccess(ctx, "project", "project-a", "read")).toBe(false);
  });

  it("treats null concrete scope_id as non-matching", () => {
    const ctx = baseCtx({
      dataScopes: [{ scopeType: "project", scopeId: null, accessLevel: "manage" }],
    });
    expect(hasDataAccess(ctx, "project", "project-a", "read")).toBe(false);
  });

  it("denies super_admin tenant actions without support grant", () => {
    const ctx = baseCtx({ role: "super_admin", supportGrant: null });
    expect(canPerform(ctx, "billing", "canView")).toBe(false);
    expect(hasDataAccess(ctx, "project", "p1", "read")).toBe(false);
  });

  it("allows super_admin platform module without grant", () => {
    const ctx = baseCtx({ role: "super_admin", supportGrant: null });
    expect(canPerform(ctx, "platform", "canManage")).toBe(true);
  });

  it("allows super_admin tenant data only with active support grant", () => {
    const ctx = baseCtx({ role: "super_admin", supportGrant: activeGrant() });
    expect(isSupportGrantActive(ctx.supportGrant, ctx.tenantId)).toBe(true);
    expect(canPerform(ctx, "billing", "canView")).toBe(true);
    expect(hasDataAccess(ctx, "project", "p1", "read")).toBe(true);
  });

  it("rejects revoked or expired support grants", () => {
    expect(
      isSupportGrantActive(activeGrant({ revokedAt: new Date().toISOString() }), "t1"),
    ).toBe(false);
    expect(
      isSupportGrantActive(
        activeGrant({ endsAt: new Date(Date.now() - 1000).toISOString() }),
        "t1",
      ),
    ).toBe(false);
  });
});
