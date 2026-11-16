import { describe, expect, it } from "vitest";
import {
  deriveConfigStatus,
  isFeatureAllowed,
  resolveEnabledFeatures,
} from "@/lib/entitlements/feature-resolve";
import { DEFAULT_ENABLED_MODULES } from "@/lib/entitlements/modules";

describe("feature entitlement resolver", () => {
  const now = Date.parse("2026-11-16T12:00:00.000Z");

  it("denies unknown features", () => {
    expect(
      isFeatureAllowed({
        featureKey: "not.a.feature",
        rows: [],
        enabledModules: DEFAULT_ENABLED_MODULES,
        configStatus: "uninitialized",
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("denies when parent module is off", () => {
    expect(
      isFeatureAllowed({
        featureKey: "documents.upload",
        rows: [{ feature_key: "documents.upload", enabled: true, expires_at: null, trial_ends_at: null }],
        enabledModules: new Set(["time"]),
        configStatus: "configured",
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("denies explicitly disabled features", () => {
    expect(
      isFeatureAllowed({
        featureKey: "documents.upload",
        rows: [{ feature_key: "documents.upload", enabled: false, expires_at: null, trial_ends_at: null }],
        enabledModules: DEFAULT_ENABLED_MODULES,
        configStatus: "configured",
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("denies expired features and does not revive via defaults", () => {
    const enabled = resolveEnabledFeatures({
      rows: [
        {
          feature_key: "documents.upload",
          enabled: true,
          expires_at: "2020-01-01T00:00:00.000Z",
          trial_ends_at: null,
        },
      ],
      enabledModules: DEFAULT_ENABLED_MODULES,
      configStatus: "configured",
      nowMs: now,
    });
    expect(enabled.has("documents.upload")).toBe(false);
  });

  it("denies expired trial unless paid_active", () => {
    expect(
      isFeatureAllowed({
        featureKey: "accountant.portal",
        rows: [
          {
            feature_key: "accountant.portal",
            enabled: true,
            expires_at: null,
            trial_ends_at: "2020-01-01T00:00:00.000Z",
            paid_active: false,
          },
        ],
        enabledModules: new Set([...DEFAULT_ENABLED_MODULES, "accountant"]),
        configStatus: "configured",
        nowMs: now,
      }),
    ).toBe(false);

    expect(
      isFeatureAllowed({
        featureKey: "accountant.portal",
        rows: [
          {
            feature_key: "accountant.portal",
            enabled: true,
            expires_at: null,
            trial_ends_at: "2020-01-01T00:00:00.000Z",
            paid_active: true,
          },
        ],
        enabledModules: new Set([...DEFAULT_ENABLED_MODULES, "accountant"]),
        configStatus: "configured",
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("allows defaults only for uninitialized tenants", () => {
    const uninit = resolveEnabledFeatures({
      rows: [],
      enabledModules: DEFAULT_ENABLED_MODULES,
      configStatus: "uninitialized",
      nowMs: now,
    });
    expect(uninit.has("documents.upload")).toBe(true);

    const configuredEmpty = resolveEnabledFeatures({
      rows: [],
      enabledModules: DEFAULT_ENABLED_MODULES,
      configStatus: "configured",
      nowMs: now,
    });
    expect(configuredEmpty.has("documents.upload")).toBe(false);
  });

  it("deriveConfigStatus distinguishes uninitialized vs configured", () => {
    expect(deriveConfigStatus({ rowCount: 0 })).toBe("uninitialized");
    expect(deriveConfigStatus({ rowCount: 0, entitlementsInitialized: true })).toBe("configured");
    expect(deriveConfigStatus({ rowCount: 2 })).toBe("configured");
    expect(deriveConfigStatus({ loadError: true, rowCount: 0 })).toBe("error");
  });
});
