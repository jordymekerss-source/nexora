import { describe, expect, it } from "vitest";
import { validateClockRange } from "@/lib/time/validate";

describe("validateClockRange", () => {
  it("rejects inverted ranges", () => {
    expect(
      validateClockRange({
        clockInIso: "2026-11-09T12:00:00.000Z",
        clockOutIso: "2026-11-09T11:00:00.000Z",
        breakMinutes: 0,
      }),
    ).toBe("negative_or_zero_duration");
  });

  it("rejects break longer than worked time", () => {
    expect(
      validateClockRange({
        clockInIso: "2026-11-09T08:00:00.000Z",
        clockOutIso: "2026-11-09T09:00:00.000Z",
        breakMinutes: 90,
      }),
    ).toBe("break_exceeds_worked");
  });

  it("allows open sessions", () => {
    expect(
      validateClockRange({
        clockInIso: "2026-11-09T08:00:00.000Z",
        clockOutIso: null,
        breakMinutes: 0,
      }),
    ).toBeNull();
  });
});
