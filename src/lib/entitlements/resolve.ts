import type { ModuleKey } from "@/lib/entitlements/modules";
import { DEFAULT_ENABLED_MODULES, isModuleKey } from "@/lib/entitlements/modules";
import type { TenantEntitlementConfigStatus } from "@/lib/entitlements/feature-resolve";

export type ModuleConfigRowLike = {
  module_key: string;
  enabled: boolean;
};

/**
 * Fail-closed module resolution.
 *
 * - uninitialized + no rows → safe MVP defaults.
 * - configured (even with zero/all-disabled rows) → honor explicit config only.
 * - error → empty set (never escalate).
 */
export function resolveEnabledModules(input: {
  rows: readonly ModuleConfigRowLike[] | null;
  loadError?: boolean;
  configStatus?: TenantEntitlementConfigStatus;
}): ReadonlySet<ModuleKey> {
  if (input.loadError === true || input.configStatus === "error") {
    return new Set<ModuleKey>();
  }

  const rows = input.rows ?? [];
  const status =
    input.configStatus ??
    (rows.length === 0 ? "uninitialized" : "configured");

  if (status === "uninitialized" && rows.length === 0) {
    return DEFAULT_ENABLED_MODULES;
  }

  const enabled = new Set<ModuleKey>();
  for (const row of rows) {
    if (row.enabled && isModuleKey(row.module_key)) {
      enabled.add(row.module_key);
    }
  }
  return enabled;
}
