import { describe, expect, it } from "vitest";
import { parseDemoPersona } from "@/lib/demo/persona";

describe("parseDemoPersona", () => {
  it("accepts known personas", () => {
    expect(parseDemoPersona("employer")).toBe("employer");
    expect(parseDemoPersona("employee-0")).toBe("employee-0");
  });

  it("never escalates invalid values to employer", () => {
    expect(parseDemoPersona("admin")).toBeNull();
    expect(parseDemoPersona("employer-hack")).toBeNull();
    expect(parseDemoPersona("")).toBeNull();
    expect(parseDemoPersona(undefined)).toBeNull();
  });
});
