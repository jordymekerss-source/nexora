/** All billable / toggleable product modules. */
export const MODULE_KEYS = [
  "crm",
  "projects",
  "planning",
  "time",
  "billing",
  "hr",
  "fleet",
  "tools",
  "work_orders",
  "calculations",
  "quotations",
  "field_service",
  "maintenance",
  "procurement",
  "inventory",
  "accounting",
  "finance",
  "quality",
  "safety",
  "documents",
  "integrations",
  "accountant",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/**
 * Safe Core MVP defaults when a tenant has no module_configs rows.
 * Enterprise modules are opt-in via Super Admin / module_configs.
 */
export const DEFAULT_ENABLED_MODULES: ReadonlySet<ModuleKey> = new Set([
  "crm",
  "projects",
  "planning",
  "time",
  "billing",
  "hr",
  "fleet",
  "tools",
  "work_orders",
  "quotations",
  "documents",
]);

/** Modules that must never default-on without commercial entitlement. */
export const OPT_IN_MODULES: ReadonlySet<ModuleKey> = new Set(
  MODULE_KEYS.filter((key) => !DEFAULT_ENABLED_MODULES.has(key)),
);
