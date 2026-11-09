import { isDemoMode } from "@/lib/demo/mode";
import { readDemoStore, seedDemoStoreIfEmpty } from "@/lib/demo/store";
import {
  DEFAULT_ENABLED_MODULES,
  isModuleKey,
  type ModuleKey,
} from "@/lib/entitlements/modules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class EntitlementDeniedError extends Error {
  readonly moduleKey: ModuleKey;

  constructor(moduleKey: ModuleKey) {
    super(`Module '${moduleKey}' is not enabled for this organization.`);
    this.name = "EntitlementDeniedError";
    this.moduleKey = moduleKey;
  }
}

export async function listEnabledModules(tenantId: string): Promise<ReadonlySet<ModuleKey>> {
  if (isDemoMode()) {
    await seedDemoStoreIfEmpty(false);
    const store = await readDemoStore();
    const rows = store.moduleConfigs.filter((row) => row.tenant_id === tenantId);
    if (rows.length === 0) {
      return DEFAULT_ENABLED_MODULES;
    }
    const enabled = new Set<ModuleKey>();
    for (const row of rows) {
      if (row.enabled && isModuleKey(row.module_key)) {
        enabled.add(row.module_key);
      }
    }
    return enabled.size > 0 ? enabled : DEFAULT_ENABLED_MODULES;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("module_configs")
    .select("module_key, enabled")
    .eq("tenant_id", tenantId);

  if (error !== null || data === null || data.length === 0) {
    return DEFAULT_ENABLED_MODULES;
  }

  const enabled = new Set<ModuleKey>();
  for (const row of data) {
    if (row.enabled && isModuleKey(row.module_key)) {
      enabled.add(row.module_key);
    }
  }
  return enabled.size > 0 ? enabled : DEFAULT_ENABLED_MODULES;
}

export async function assertModuleEnabled(
  tenantId: string,
  moduleKey: ModuleKey,
): Promise<void> {
  const enabled = await listEnabledModules(tenantId);
  if (!enabled.has(moduleKey)) {
    throw new EntitlementDeniedError(moduleKey);
  }
}
