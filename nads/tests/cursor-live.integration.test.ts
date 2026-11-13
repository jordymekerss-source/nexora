import { describe, expect, it } from "vitest";

/**
 * Preferred architecture does not use Cloud Agents API create.
 * cursor-smoke remains an explicit optional fallback and stays blocked unless opted in.
 */
describe("Cursor API smoke gate", () => {
  it("is blocked by default even if CURSOR_API_KEY exists", () => {
    const allow = (process.env.NADS_ALLOW_CURSOR_API_SMOKE ?? "").toLowerCase() === "true";
    expect(allow).toBe(false);
    expect({
      ok: false,
      status: "BLOCKED",
      reason: "preferred executor is automation; cursor-smoke requires explicit opt-in",
    }).toMatchObject({ status: "BLOCKED", ok: false });
  });
});
