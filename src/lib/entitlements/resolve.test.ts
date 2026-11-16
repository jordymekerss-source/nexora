import { describe, expect, it } from "vitest";
import { resolveEnabledModules } from "@/lib/entitlements/resolve";
import { DEFAULT_ENABLED_MODULES } from "@/lib/entitlements/modules";

describe("resolveEnabledModules fail-closed", () => {
  it("uses defaults only when tenant has no module_configs rows", () => {
    const enabled = resolveEnabledModules({ rows: [] });
    expect(enabled).toEqual(DEFAULT_ENABLED_MODULES);
  });

  it("honors explicit all-disabled configuration", () => {
    const enabled = resolveEnabledModules({
      rows: [
        { module_key: "crm", enabled: false },
        { module_key: "billing", enabled: false },
        { module_key: "time", enabled: false },
      ],
    });
    expect(enabled.size).toBe(0);
    expect(enabled.has("crm")).toBe(false);
  });

  it("returns only explicitly enabled modules", () => {
    const enabled = resolveEnabledModules({
      rows: [
        { module_key: "crm", enabled: true },
        { module_key: "billing", enabled: false },
        { module_key: "time", enabled: true },
      ],
    });
    expect(enabled.has("crm")).toBe(true);
    expect(enabled.has("time")).toBe(true);
    expect(enabled.has("billing")).toBe(false);
  });

  it("fails closed on load errors", () => {
    const enabled = resolveEnabledModules({ rows: null, loadError: true });
    expect(enabled.size).toBe(0);
  });

  it("treats configured empty config as all-disabled", () => {
    const enabled = resolveEnabledModules({
      rows: [],
      configStatus: "configured",
    });
    expect(enabled.size).toBe(0);
  });
});

