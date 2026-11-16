import type {
  AccessLevel,
  ActionPermission,
  DataScopeType,
  SessionPermissionContext,
} from "@/lib/permissions/types";
import { EMPTY_ACTION } from "@/lib/permissions/types";

/**
 * Role defaults used when no Layer-3 override row exists for a module.
 * Super Admin / employer retain broad defaults; employees are restrictive.
 */
export function defaultActionPermissionForRole(
  role: SessionPermissionContext["role"],
  moduleKey: string,
): ActionPermission {
  if (role === "super_admin") {
    return {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canApprove: true,
      canExport: true,
      canManage: true,
    };
  }
  if (role === "employer") {
    return {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canApprove: true,
      canExport: true,
      canManage: true,
    };
  }
  if (role === "accountant") {
    const financeLike = moduleKey === "billing" || moduleKey === "accounting" || moduleKey === "finance";
    return {
      canView: financeLike || moduleKey === "documents" || moduleKey === "accountant",
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canApprove: false,
      canExport: financeLike,
      canManage: false,
    };
  }
  if (role === "employee") {
    const field = ["time", "work_orders", "projects", "field_service"].includes(moduleKey);
    return {
      canView: field || moduleKey === "documents",
      canCreate: field,
      canEdit: field,
      canDelete: false,
      canApprove: false,
      canExport: false,
      canManage: false,
    };
  }
  return { ...EMPTY_ACTION };
}

export function resolveActionPermission(
  ctx: SessionPermissionContext,
  moduleKey: string,
): ActionPermission {
  if (!ctx.enabledModules.includes(moduleKey) && roleNeedsModule(ctx.role)) {
    return { ...EMPTY_ACTION };
  }
  const override = ctx.actionPermissions.get(moduleKey);
  if (override !== undefined) {
    return override;
  }
  return defaultActionPermissionForRole(ctx.role, moduleKey);
}

function roleNeedsModule(role: SessionPermissionContext["role"]): boolean {
  return role === "employer" || role === "employee" || role === "accountant";
}

export function canPerform(
  ctx: SessionPermissionContext,
  moduleKey: string,
  action: keyof ActionPermission,
): boolean {
  if (ctx.role === "super_admin") return true;
  const perm = resolveActionPermission(ctx, moduleKey);
  return perm[action] === true;
}

const ACCESS_RANK: Record<AccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  approve: 3,
  manage: 4,
};

export function hasDataAccess(
  ctx: SessionPermissionContext,
  scopeType: DataScopeType,
  scopeId: string | null,
  required: AccessLevel,
): boolean {
  if (ctx.role === "super_admin" || ctx.role === "employer") {
    return required !== "none";
  }
  const needed = ACCESS_RANK[required];
  for (const scope of ctx.dataScopes) {
    if (scope.accessLevel === "none") continue;
    if (scope.scopeType === "all_projects" && (scopeType === "project" || scopeType === "all_projects")) {
      if (ACCESS_RANK[scope.accessLevel] >= needed) return true;
    }
    if (scope.scopeType === "all_clients" && (scopeType === "client" || scopeType === "all_clients")) {
      if (ACCESS_RANK[scope.accessLevel] >= needed) return true;
    }
    if (scope.scopeType === scopeType && (scope.scopeId === null || scope.scopeId === scopeId)) {
      if (ACCESS_RANK[scope.accessLevel] >= needed) return true;
    }
  }
  // No explicit scopes: employees may access assigned projects via other tables;
  // deny finance/hr by default.
  if (scopeType === "finance" || scopeType === "hr") {
    return false;
  }
  return ctx.role === "employee" && required === "read";
}
