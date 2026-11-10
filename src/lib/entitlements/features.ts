/**
 * Fine-grained features nested under modules.
 * Checked in addition to module entitlements.
 */
export const FEATURE_KEYS = [
  "documents.upload",
  "documents.antivirus",
  "accountant.portal",
  "accountant.export_pack",
  "accounting.purchase_invoices",
  "accounting.bank_psd2",
  "accounting.ubl_export",
  "accounting.peppol",
  "integrations.exact",
  "integrations.yuki",
  "integrations.afas",
  "integrations.snelstart",
  "field_service.offline",
  "planning.route_optimization",
  "inventory.barcode",
  "inventory.auto_reorder",
  "calculations.engine",
  "maintenance.contracts",
  "quality.vca",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/** Features enabled when the parent module is on and no feature row exists. */
export const DEFAULT_ENABLED_FEATURES: ReadonlySet<FeatureKey> = new Set([
  "documents.upload",
]);
