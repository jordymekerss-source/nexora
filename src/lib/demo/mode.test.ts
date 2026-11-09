import { afterEach, describe, expect, it } from "vitest";
import { assertDemoModeAllowed, isDemoMode } from "@/lib/demo/mode";

const KEYS = [
  "NEXT_PUBLIC_DEMO_MODE",
  "ALLOW_DEMO_IN_PRODUCTION",
  "NODE_ENV",
] as const;

const snapshot: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function setEnv(key: (typeof KEYS)[number], value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete env[key];
  } else {
    env[key] = value;
  }
}

afterEach(() => {
  for (const key of KEYS) {
    setEnv(key, snapshot[key]);
  }
});

function remember(): void {
  for (const key of KEYS) {
    snapshot[key] = process.env[key];
  }
}

describe("demo mode gate", () => {
  it("is off unless explicitly true", () => {
    remember();
    setEnv("NEXT_PUBLIC_DEMO_MODE", undefined);
    expect(isDemoMode()).toBe(false);
    setEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    expect(isDemoMode()).toBe(false);
    setEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(isDemoMode()).toBe(true);
  });

  it("refuses demo in production without allow flag", () => {
    remember();
    setEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    setEnv("NODE_ENV", "production");
    setEnv("ALLOW_DEMO_IN_PRODUCTION", undefined);
    expect(() => assertDemoModeAllowed()).toThrow(/ALLOW_DEMO_IN_PRODUCTION/);
  });

  it("allows explicit demo deployment in production", () => {
    remember();
    setEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    setEnv("NODE_ENV", "production");
    setEnv("ALLOW_DEMO_IN_PRODUCTION", "true");
    expect(() => assertDemoModeAllowed()).not.toThrow();
  });
});


