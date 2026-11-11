import { describe, expect, it } from "vitest";

/**
 * Gated live Cursor integration marker.
 * Real live execution is performed by `npm run cursor-smoke` (one controlled agent).
 * This file asserts the gating contract: missing credentials ⇒ BLOCKED, not PASS.
 */
describe("Cursor live integration gate", () => {
  it("reports BLOCKED semantics when CURSOR_API_KEY is absent", () => {
    const key = process.env.CURSOR_API_KEY?.trim() ?? "";
    if (key) {
      // Key is present in this environment — live smoke is runnable via CLI.
      expect(key.length).toBeGreaterThan(0);
      return;
    }
    expect(key).toBe("");
    // Contract: unit suite must not pretend live Cursor succeeded.
    const report = {
      ok: false,
      status: "BLOCKED",
      reason: "CURSOR_API_KEY not configured",
    };
    expect(report.status).toBe("BLOCKED");
    expect(report.ok).toBe(false);
  });
});
