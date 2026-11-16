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
