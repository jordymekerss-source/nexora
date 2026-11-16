export type ActionPermission = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canExport: boolean;
  canManage: boolean;
};

export type DataScopeType =
  | "project"
  | "client"
  | "folder"
  | "document"
  | "time"
  | "finance"
  | "hr"
  | "all_projects"
  | "all_clients";

export type AccessLevel = "read" | "write" | "approve" | "manage" | "none";

/** Temporary, audited Super Admin support access into one tenant. */
export type SupportGrant = {
  tenantId: string;
  reason: string;
  /** Module keys allowed, or ["*"] for all modules within the grant window. */
  scopes: readonly string[];
  startsAt: string;
  endsAt: string;
  revokedAt: string | null;
};

export type SessionPermissionContext = {
  userId: string;
  tenantId: string | null;
  role: "super_admin" | "employer" | "employee" | "accountant" | "none";
  enabledModules: readonly string[];
  enabledFeatures: readonly string[];
  actionPermissions: ReadonlyMap<string, ActionPermission>;
  dataScopes: readonly {
    scopeType: DataScopeType;
    scopeId: string | null;
    accessLevel: AccessLevel;
  }[];
  /** Required for super_admin tenant-data access. Never implied. */
  supportGrant: SupportGrant | null;
};

export const EMPTY_ACTION: ActionPermission = {
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canApprove: false,
  canExport: false,
  canManage: false,
};

/** Modules that are platform-ops only — not customer tenant data. */
export const PLATFORM_ADMIN_MODULES: ReadonlySet<string> = new Set([
  "platform",
  "integrations",
]);
