import { describe, expect, it } from "vitest";
import {
  BOOKKEEPING_ADAPTERS,
  IntegrationNotConfiguredError,
  requireConfiguredAdapter,
} from "@/modules/integrations/services/adapter";

describe("integration adapters", () => {
  it("exposes stub bookkeeping adapters that are not configured", () => {
    expect(BOOKKEEPING_ADAPTERS.length).toBeGreaterThanOrEqual(4);
    for (const adapter of BOOKKEEPING_ADAPTERS) {
      expect(adapter.isConfigured()).toBe(false);
    }
  });

  it("refuses sync when not configured", () => {
    const adapter = BOOKKEEPING_ADAPTERS[0]!;
    expect(() => requireConfiguredAdapter(adapter)).toThrow(IntegrationNotConfiguredError);
  });
});
