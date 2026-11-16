import { describe, expect, it } from "vitest";
import { parseBreakMinutes, parseUserDateTime } from "@/lib/time/parse";
import { validateClockRange } from "@/lib/time/validate";

describe("time parse + validate", () => {
  it("rejects invalid datetime instead of normalizing", () => {
    expect(parseUserDateTime("not-a-date").ok).toBe(false);
    expect(parseUserDateTime("").ok).toBe(false);
  });

  it("accepts datetime-local values", () => {
    const parsed = parseUserDateTime("2026-11-16T08:30");
    expect(parsed.ok).toBe(true);
  });

  it("rejects negative breaks without silent clamp", () => {
    expect(parseBreakMinutes("-5")).toEqual({ ok: false, reason: "negative" });
  });

  it("rejects unrealistic shift length", () => {
    const issue = validateClockRange({
      clockInIso: "2026-11-01T08:00:00.000Z",
      clockOutIso: "2026-11-05T08:00:00.000Z",
      breakMinutes: 0,
    });
    expect(issue).toBe("unrealistic_duration");
  });
});
