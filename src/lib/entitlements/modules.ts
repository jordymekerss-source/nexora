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
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Defaults when a tenant has no module_configs rows yet (safe MVP defaults). */
export const DEFAULT_ENABLED_MODULES: ReadonlySet<ModuleKey> = new Set(MODULE_KEYS);
