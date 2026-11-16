import {
  DEFAULT_ENABLED_FEATURES,
  isFeatureKey,
  type FeatureKey,
} from "@/lib/entitlements/features";
import type { ModuleKey } from "@/lib/entitlements/modules";

export type FeatureEntitlementRowLike = {
  feature_key: string;
  enabled: boolean;
  expires_at: string | null;
  trial_ends_at: string | null;
  /** When true, feature remains active after trial if commercially entitled. */
  paid_active?: boolean | null;
};

export type TenantEntitlementConfigStatus = "uninitialized" | "configured" | "error";

/** Parent module required before a feature can be allowed. */
export const FEATURE_PARENT_MODULE: Readonly<Record<FeatureKey, ModuleKey>> = {
  "documents.upload": "documents",
  "documents.antivirus": "documents",
  "accountant.portal": "accountant",
  "accountant.export_pack": "accountant",
  "accounting.purchase_invoices": "accounting",
  "accounting.bank_psd2": "accounting",
  "accounting.ubl_export": "accounting",
  "accounting.peppol": "accounting",
  "integrations.exact": "integrations",
  "integrations.yuki": "integrations",
  "integrations.afas": "integrations",
  "integrations.snelstart": "integrations",
  "field_service.offline": "field_service",
  "planning.route_optimization": "planning",
  "inventory.barcode": "inventory",
  "inventory.auto_reorder": "inventory",
  "calculations.engine": "calculations",
  "maintenance.contracts": "maintenance",
  "quality.vca": "quality",
};

export function isFeatureAllowed(input: {
  featureKey: string;
  rows: readonly FeatureEntitlementRowLike[] | null;
  enabledModules: ReadonlySet<ModuleKey>;
  configStatus: TenantEntitlementConfigStatus;
  nowMs?: number;
}): boolean {
  const now = input.nowMs ?? Date.now();

  if (!isFeatureKey(input.featureKey)) {
    return false;
  }
  if (input.configStatus === "error") {
    return false;
  }

  const parent = FEATURE_PARENT_MODULE[input.featureKey];
  if (!input.enabledModules.has(parent)) {
    return false;
  }

  const rows = input.rows ?? [];
  const explicit = rows.find((row) => row.feature_key === input.featureKey);

  if (explicit !== undefined) {
    if (!explicit.enabled) {
      return false;
    }
    if (explicit.expires_at !== null && Date.parse(explicit.expires_at) < now) {
      return false;
    }
    if (
      explicit.trial_ends_at !== null &&
      Date.parse(explicit.trial_ends_at) < now &&
      explicit.paid_active !== true
    ) {
      return false;
    }
    return true;
  }

  // No row: only uninitialized tenants may receive safe defaults.
  if (input.configStatus === "uninitialized") {
    return DEFAULT_ENABLED_FEATURES.has(input.featureKey);
  }

  return false;
}

/**
 * Deterministic feature resolution.
 * Never re-enables an expired/disabled default by merging after evaluation.
 */
export function resolveEnabledFeatures(input: {
  rows: readonly FeatureEntitlementRowLike[] | null;
  enabledModules: ReadonlySet<ModuleKey>;
  configStatus: TenantEntitlementConfigStatus;
  nowMs?: number;
}): ReadonlySet<FeatureKey> {
  if (input.configStatus === "error") {
    return new Set();
  }

  const enabled = new Set<FeatureKey>();
  const candidates = new Set<FeatureKey>();

  for (const row of input.rows ?? []) {
    if (isFeatureKey(row.feature_key)) {
      candidates.add(row.feature_key);
    }
  }
  if (input.configStatus === "uninitialized") {
    for (const key of DEFAULT_ENABLED_FEATURES) {
      candidates.add(key);
    }
  }

  for (const key of candidates) {
    if (
      isFeatureAllowed({
        featureKey: key,
        rows: input.rows,
        enabledModules: input.enabledModules,
        configStatus: input.configStatus,
        nowMs: input.nowMs,
      })
    ) {
      enabled.add(key);
    }
  }
  return enabled;
}

export function deriveConfigStatus(input: {
  loadError?: boolean;
  entitlementsInitialized?: boolean | null;
  rowCount: number;
}): TenantEntitlementConfigStatus {
  if (input.loadError === true) {
    return "error";
  }
  if (input.entitlementsInitialized === true || input.rowCount > 0) {
    return "configured";
  }
  return "uninitialized";
}
