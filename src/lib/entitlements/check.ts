import { isDemoMode } from "@/lib/demo/mode";
import { readDemoStore, seedDemoStoreIfEmpty } from "@/lib/demo/store";
import {
  deriveConfigStatus,
  resolveEnabledFeatures,
  type TenantEntitlementConfigStatus,
} from "@/lib/entitlements/feature-resolve";
import type { FeatureKey } from "@/lib/entitlements/features";
import { resolveEnabledModules } from "@/lib/entitlements/resolve";
import type { ModuleKey } from "@/lib/entitlements/modules";
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

async function demoConfigStatus(tenantId: string): Promise<{
  status: TenantEntitlementConfigStatus;
  rows: { module_key: string; enabled: boolean }[];
}> {
  await seedDemoStoreIfEmpty(false);
  const store = await readDemoStore();
  const rows = store.moduleConfigs.filter((row) => row.tenant_id === tenantId);
  const initialized =
    (store as { entitlementsInitialized?: boolean }).entitlementsInitialized === true ||
    rows.length > 0;
  return {
    status: deriveConfigStatus({
      entitlementsInitialized: initialized,
      rowCount: rows.length,
    }),
    rows,
  };
}

export async function listEnabledModules(tenantId: string): Promise<ReadonlySet<ModuleKey>> {
  if (isDemoMode()) {
    const { status, rows } = await demoConfigStatus(tenantId);
    return resolveEnabledModules({ rows, configStatus: status });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("module_configs")
    .select("module_key, enabled")
    .eq("tenant_id", tenantId);

  if (error !== null) {
    return resolveEnabledModules({ rows: null, loadError: true, configStatus: "error" });
  }

  // Column entitlements_initialized is added by migration 20251116230000.
  // Until generated DB types include it, derive from row presence (configured if any rows).
  const rows = data ?? [];
  const status = deriveConfigStatus({ rowCount: rows.length });
  return resolveEnabledModules({ rows, configStatus: status });
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
  const modules = await listEnabledModules(tenantId);

  if (isDemoMode()) {
    // Demo has no feature_entitlements rows yet → uninitialized feature config.
    return resolveEnabledFeatures({
      rows: [],
      enabledModules: modules,
      configStatus: "uninitialized",
    });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("feature_entitlements")
    .select("feature_key, enabled, expires_at, trial_ends_at")
    .eq("tenant_id", tenantId);

  if (error !== null) {
    return resolveEnabledFeatures({
      rows: null,
      enabledModules: modules,
      configStatus: "error",
    });
  }

  const rows = data ?? [];
  const status = deriveConfigStatus({ rowCount: rows.length });

  return resolveEnabledFeatures({
    rows,
    enabledModules: modules,
    configStatus: status,
  });
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
