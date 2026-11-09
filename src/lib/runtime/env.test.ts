import { afterEach, describe, expect, it } from "vitest";
import { assertRuntimeConfiguration } from "@/lib/runtime/env";

const KEYS = [
  "NEXT_PUBLIC_DEMO_MODE",
  "ALLOW_DEMO_IN_PRODUCTION",
  "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const snapshot: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

function setEnv(key: (typeof KEYS)[number], value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

function remember(): void {
  for (const key of KEYS) snapshot[key] = process.env[key];
}

afterEach(() => {
  for (const key of KEYS) {
    const value = snapshot[key];
    setEnv(key, value);
  }
});

describe("assertRuntimeConfiguration", () => {
  it("fails closed in live mode without Supabase env", () => {
    remember();
    setEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    setEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    setEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
    expect(() => assertRuntimeConfiguration()).toThrow(/Live mode requires/);
  });

  it("allows explicit demo", () => {
    remember();
    setEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    setEnv("NODE_ENV", "development");
    expect(() => assertRuntimeConfiguration()).not.toThrow();
  });
});
