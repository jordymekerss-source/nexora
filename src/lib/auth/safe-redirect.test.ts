import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

describe("safeInternalPath", () => {
  it("allows relative app paths", () => {
    expect(safeInternalPath("/dashboard")).toBe("/dashboard");
    expect(safeInternalPath("/employer/clients?x=1")).toBe("/employer/clients?x=1");
  });

  it("rejects open redirects", () => {
    expect(safeInternalPath("https://evil.example/phish")).toBe("/dashboard");
    expect(safeInternalPath("//evil.example")).toBe("/dashboard");
    expect(safeInternalPath("/\\evil.example")).toBe("/dashboard");
    expect(safeInternalPath("evil.example")).toBe("/dashboard");
  });

  it("uses fallback for empty values", () => {
    expect(safeInternalPath(null, "/login")).toBe("/login");
    expect(safeInternalPath("   ", "/login")).toBe("/login");
  });
});
