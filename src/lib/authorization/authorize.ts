import { canPerform, hasDataAccess } from "@/lib/permissions/evaluate";
import type {
  AccessLevel,
  ActionPermission,
  DataScopeType,
  SessionPermissionContext,
} from "@/lib/permissions/types";

export type AuthorizeAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "export"
  | "manage";

export type AuthorizeResource = {
  moduleKey: string;
  scopeType?: DataScopeType;
  scopeId?: string | null;
  /** When set, must equal actor.tenantId. */
  resourceTenantId?: string | null;
};

export type AuthorizeDecision = {
  allowed: boolean;
  reason: string;
  code:
    | "allow"
    | "unauthenticated"
    | "no_tenant"
    | "tenant_mismatch"
    | "module_denied"
    | "action_denied"
    | "scope_denied"
    | "super_admin_no_grant";
};

const ACTION_TO_PERM: Record<AuthorizeAction, keyof ActionPermission> = {
  view: "canView",
  create: "canCreate",
  edit: "canEdit",
  delete: "canDelete",
  approve: "canApprove",
  export: "canExport",
  manage: "canManage",
};

const ACTION_TO_ACCESS: Record<AuthorizeAction, AccessLevel> = {
  view: "read",
  create: "write",
  edit: "write",
  delete: "manage",
  approve: "approve",
  export: "read",
  manage: "manage",
};

/**
 * Central authorization decision. Same rules for server actions, API, mobile.
 * Frontend may mirror for UX but must never be the only control.
 */
export function authorize(
  actor: SessionPermissionContext | null,
  resource: AuthorizeResource,
  action: AuthorizeAction,
): AuthorizeDecision {
  if (actor == null || actor.role === "none" || actor.userId.length === 0) {
    return { allowed: false, reason: "Niet geauthenticeerd.", code: "unauthenticated" };
  }

  if (actor.tenantId == null) {
    return { allowed: false, reason: "Geen organisatieworkspace.", code: "no_tenant" };
  }

  if (
    resource.resourceTenantId != null &&
    resource.resourceTenantId !== actor.tenantId
  ) {
    return {
      allowed: false,
      reason: "Resource behoort tot een andere organisatie.",
      code: "tenant_mismatch",
    };
  }

  if (actor.role === "super_admin") {
    const platformOnly = resource.moduleKey === "platform" || resource.moduleKey === "integrations";
    if (!platformOnly && actor.supportGrant == null) {
      return {
        allowed: false,
        reason: "Super Admin heeft geen actieve supportautorisatie voor deze tenant.",
        code: "super_admin_no_grant",
      };
    }
  }

  if (!canPerform(actor, resource.moduleKey, ACTION_TO_PERM[action])) {
    if (
      actor.role !== "super_admin" &&
      !actor.enabledModules.includes(resource.moduleKey)
    ) {
      return {
        allowed: false,
        reason: `Module '${resource.moduleKey}' is niet beschikbaar.`,
        code: "module_denied",
      };
    }
    return {
      allowed: false,
      reason: "Actie niet toegestaan voor deze rol of rechten.",
      code: "action_denied",
    };
  }

  if (resource.scopeType !== undefined) {
    const ok = hasDataAccess(
      actor,
      resource.scopeType,
      resource.scopeId ?? null,
      ACTION_TO_ACCESS[action],
    );
    if (!ok) {
      return {
        allowed: false,
        reason: "Geen datascope voor deze resource.",
        code: "scope_denied",
      };
    }
  }

  return { allowed: true, reason: "Toegestaan.", code: "allow" };
}

export function assertAuthorized(
  actor: SessionPermissionContext | null,
  resource: AuthorizeResource,
  action: AuthorizeAction,
): void {
  const decision = authorize(actor, resource, action);
  if (!decision.allowed) {
    const error = new Error(decision.reason);
    error.name = "AuthorizationError";
    (error as Error & { code: string }).code = decision.code;
    throw error;
  }
}
