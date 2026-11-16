import { isDemoMode } from "@/lib/demo/mode";
import { readDemoStore, seedDemoStoreIfEmpty } from "@/lib/demo/store";
import {
  DEFAULT_ENABLED_FEATURES,
  isFeatureKey,
  type FeatureKey,
} from "@/lib/entitlements/features";
import { resolveEnabledModules } from "@/lib/entitlements/resolve";
import { isModuleKey, type ModuleKey } from "@/lib/entitlements/modules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class EntitlementDeniedError extends Error {
  readonly moduleKey: ModuleKey;

  constructor(moduleKey: ModuleKey) {
    super(`Module '${moduleKey}' is not enabled for this organization.`);
    this.name = "EntitlementDeniedError";
    this.moduleKey = moduleKey;
  }
}

export class FeatureDeniedError extends Error {
  readonly featureKey: FeatureKey;

  constructor(featureKey: FeatureKey) {
    super(`Feature '${featureKey}' is not enabled for this organization.`);
    this.name = "FeatureDeniedError";
    this.featureKey = featureKey;
  }
}

export async function listEnabledModules(tenantId: string): Promise<ReadonlySet<ModuleKey>> {
  if (isDemoMode()) {
    await seedDemoStoreIfEmpty(false);
    const store = await readDemoStore();
    const rows = store.moduleConfigs.filter((row) => row.tenant_id === tenantId);
    return resolveEnabledModules({ rows });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("module_configs")
    .select("module_key, enabled")
    .eq("tenant_id", tenantId);

  if (error !== null) {
    return resolveEnabledModules({ rows: null, loadError: true });
  }

  return resolveEnabledModules({ rows: data ?? [] });
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

export async function listEnabledFeatures(tenantId: string): Promise<ReadonlySet<FeatureKey>> {
  if (isDemoMode()) {
    return DEFAULT_ENABLED_FEATURES;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("feature_entitlements")
    .select("feature_key, enabled, expires_at, trial_ends_at")
    .eq("tenant_id", tenantId);

  if (error !== null) {
    // Fail closed on feature load errors.
    return new Set<FeatureKey>();
  }

  if (data === null || data.length === 0) {
    return DEFAULT_ENABLED_FEATURES;
  }

  const now = Date.now();
  const enabled = new Set<FeatureKey>();
  const explicitlyDisabled = new Set<string>();

  for (const row of data) {
    if (!isFeatureKey(row.feature_key)) {
      continue;
    }
    if (!row.enabled) {
      explicitlyDisabled.add(row.feature_key);
      continue;
    }
    if (row.expires_at !== null && Date.parse(row.expires_at) < now) {
      continue;
    }
    enabled.add(row.feature_key);
  }

  for (const key of DEFAULT_ENABLED_FEATURES) {
    if (!explicitlyDisabled.has(key)) {
      enabled.add(key);
    }
  }
  return enabled;
}

export async function assertFeatureEnabled(
  tenantId: string,
  featureKey: FeatureKey,
): Promise<void> {
  const enabled = await listEnabledFeatures(tenantId);
  if (!enabled.has(featureKey)) {
    throw new FeatureDeniedError(featureKey);
  }
}
