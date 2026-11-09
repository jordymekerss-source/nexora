import { describe, expect, it } from "vitest";
import { DEFAULT_ENABLED_MODULES, isModuleKey } from "@/lib/entitlements/modules";

describe("module entitlements", () => {
  it("recognizes known module keys", () => {
    expect(isModuleKey("crm")).toBe(true);
    expect(isModuleKey("billing")).toBe(true);
    expect(isModuleKey("not-a-module")).toBe(false);
  });

  it("defaults enable core MVP modules", () => {
    expect(DEFAULT_ENABLED_MODULES.has("time")).toBe(true);
    expect(DEFAULT_ENABLED_MODULES.has("crm")).toBe(true);
    expect(DEFAULT_ENABLED_MODULES.has("billing")).toBe(true);
  });
});
