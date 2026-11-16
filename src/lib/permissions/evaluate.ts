import type {
  AccessLevel,
  ActionPermission,
  DataScopeType,
  SessionPermissionContext,
  SupportGrant,
} from "@/lib/permissions/types";
import { EMPTY_ACTION, PLATFORM_ADMIN_MODULES } from "@/lib/permissions/types";

/**
 * Role defaults used when no Layer-3 override row exists for a module.
 * Super Admin does NOT get tenant-data defaults — only platform modules.
 */
export function defaultActionPermissionForRole(
  role: SessionPermissionContext["role"],
  moduleKey: string,
): ActionPermission {
  if (role === "super_admin") {
    if (PLATFORM_ADMIN_MODULES.has(moduleKey)) {
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
    return { ...EMPTY_ACTION };
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
    const financeLike =
      moduleKey === "billing" || moduleKey === "accounting" || moduleKey === "finance";
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

export function isSupportGrantActive(
  grant: SupportGrant | null | undefined,
  tenantId: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (grant == null || tenantId == null) {
    return false;
  }
  if (grant.tenantId !== tenantId) {
    return false;
  }
  if (grant.revokedAt != null) {
    return false;
  }
  const start = Date.parse(grant.startsAt);
  const end = Date.parse(grant.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }
  return start <= nowMs && nowMs <= end;
}

function supportAllowsModule(ctx: SessionPermissionContext, moduleKey: string): boolean {
  if (!isSupportGrantActive(ctx.supportGrant, ctx.tenantId)) {
    return false;
  }
  const scopes = ctx.supportGrant!.scopes;
  return scopes.includes("*") || scopes.includes(moduleKey);
}

export function resolveActionPermission(
  ctx: SessionPermissionContext,
  moduleKey: string,
): ActionPermission {
  if (ctx.role === "super_admin") {
    if (PLATFORM_ADMIN_MODULES.has(moduleKey)) {
      return defaultActionPermissionForRole("super_admin", moduleKey);
    }
    if (!supportAllowsModule(ctx, moduleKey)) {
      return { ...EMPTY_ACTION };
    }
    // Active support grant: employer-equivalent within granted modules.
    const override = ctx.actionPermissions.get(moduleKey);
    if (override !== undefined) {
      return override;
    }
    return defaultActionPermissionForRole("employer", moduleKey);
  }

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

const WILDCARD_SCOPES: ReadonlySet<DataScopeType> = new Set(["all_projects", "all_clients"]);

/**
 * Layer-4 data access. Deny by default.
 * - null scope_id on concrete types never means "all resources".
 * - Employees need an explicit matching scope (or all_* wildcard).
 * - Super Admin needs an active support grant for the tenant.
 */
export function hasDataAccess(
  ctx: SessionPermissionContext,
  scopeType: DataScopeType,
  scopeId: string | null,
  required: AccessLevel,
): boolean {
  if (required === "none") {
    return true;
  }

  if (ctx.role === "super_admin") {
    if (!isSupportGrantActive(ctx.supportGrant, ctx.tenantId)) {
      return false;
    }
    // Support grant covers tenant; still require grant scopes for finance/hr sensitivity.
    if (
      (scopeType === "finance" || scopeType === "hr") &&
      ctx.supportGrant !== null &&
      !ctx.supportGrant.scopes.includes("*") &&
      !ctx.supportGrant.scopes.includes(scopeType)
    ) {
      return false;
    }
    return true;
  }

  if (ctx.role === "employer") {
    // Employer access is tenant-scoped via session tenantId (validated by caller).
    return ctx.tenantId != null;
  }

  if (ctx.role === "none" || ctx.tenantId == null) {
    return false;
  }

  const needed = ACCESS_RANK[required];

  for (const scope of ctx.dataScopes) {
    if (scope.accessLevel === "none") {
      continue;
    }
    if (ACCESS_RANK[scope.accessLevel] < needed) {
      continue;
    }

    if (scope.scopeType === "all_projects" && (scopeType === "project" || scopeType === "all_projects")) {
      return true;
    }
    if (scope.scopeType === "all_clients" && (scopeType === "client" || scopeType === "all_clients")) {
      return true;
    }

    if (scope.scopeType !== scopeType) {
      continue;
    }

    // Concrete scopes require an explicit resource id match.
    // A null scope_id must never authorize an arbitrary resource.
    if (WILDCARD_SCOPES.has(scope.scopeType)) {
      return true;
    }
    if (scope.scopeId == null || scopeId == null) {
      continue;
    }
    if (scope.scopeId === scopeId) {
      return true;
    }
  }

  return false;
}
