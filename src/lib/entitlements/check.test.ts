import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, isFeatureKey } from "@/lib/entitlements/features";
import {
  DEFAULT_ENABLED_MODULES,
  isModuleKey,
  OPT_IN_MODULES,
} from "@/lib/entitlements/modules";

describe("module entitlements", () => {
  it("recognizes known module keys", () => {
    expect(isModuleKey("crm")).toBe(true);
    expect(isModuleKey("billing")).toBe(true);
    expect(isModuleKey("accountant")).toBe(true);
    expect(isModuleKey("documents")).toBe(true);
    expect(isModuleKey("not-a-module")).toBe(false);
  });

  it("defaults enable core MVP modules only", () => {
    expect(DEFAULT_ENABLED_MODULES.has("time")).toBe(true);
    expect(DEFAULT_ENABLED_MODULES.has("crm")).toBe(true);
    expect(DEFAULT_ENABLED_MODULES.has("billing")).toBe(true);
    expect(DEFAULT_ENABLED_MODULES.has("documents")).toBe(true);
    expect(DEFAULT_ENABLED_MODULES.has("accountant")).toBe(false);
    expect(DEFAULT_ENABLED_MODULES.has("accounting")).toBe(false);
    expect(OPT_IN_MODULES.has("accountant")).toBe(true);
  });

  it("registers fine-grained features", () => {
    expect(isFeatureKey("accountant.portal")).toBe(true);
    expect(isFeatureKey("documents.upload")).toBe(true);
    expect(FEATURE_KEYS.includes("accounting.peppol")).toBe(true);
    expect(isFeatureKey("not.a.feature")).toBe(false);
  });
});
