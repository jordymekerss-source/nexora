import type { ModuleKey } from "@/lib/entitlements/modules";
import { DEFAULT_ENABLED_MODULES, isModuleKey } from "@/lib/entitlements/modules";

export type ModuleConfigRowLike = {
  module_key: string;
  enabled: boolean;
};

/**
 * Fail-closed module resolution.
 *
 * - No rows → uninitialized tenant → safe MVP defaults.
 * - Rows present (even all disabled) → honor explicit config; never re-open defaults.
 * - loadError → deny all optional access (empty set). Never escalate on failure.
 */
export function resolveEnabledModules(input: {
  rows: readonly ModuleConfigRowLike[] | null;
  loadError?: boolean;
}): ReadonlySet<ModuleKey> {
  if (input.loadError === true) {
    return new Set<ModuleKey>();
  }

  if (input.rows === null || input.rows.length === 0) {
    return DEFAULT_ENABLED_MODULES;
  }

  const enabled = new Set<ModuleKey>();
  for (const row of input.rows) {
    if (row.enabled && isModuleKey(row.module_key)) {
      enabled.add(row.module_key);
    }
  }
  return enabled;
}
