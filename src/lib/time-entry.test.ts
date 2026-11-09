import { describe, expect, it } from "vitest";
import { computeWorkedMinutes } from "@/lib/time-entry";

describe("computeWorkedMinutes", () => {
  it("subtracts only recorded break minutes", () => {
    const minutes = computeWorkedMinutes({
      clockIn: "2026-11-09T08:00:00.000Z",
      clockOut: "2026-11-09T12:00:00.000Z",
      breakMinutes: 30,
    });
    expect(minutes).toBe(210);
  });

  it("does not invent breaks when breakMinutes is 0", () => {
    const minutes = computeWorkedMinutes({
      clockIn: "2026-11-09T08:00:00.000Z",
      clockOut: "2026-11-09T12:00:00.000Z",
      breakMinutes: 0,
    });
    expect(minutes).toBe(240);
  });
});
