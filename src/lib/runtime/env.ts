import { assertDemoModeAllowed, isDemoMode } from "@/lib/demo/mode";

/**
 * Fail closed: live mode requires Supabase public config.
 * Demo mode requires explicit opt-in (and prod allow flag when NODE_ENV=production).
 */
export function assertRuntimeConfiguration(): void {
  assertDemoModeAllowed();

  if (isDemoMode()) {
    return;
  }

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anon = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (url === undefined || url.length === 0 || anon === undefined || anon.length === 0) {
    throw new Error(
      "Live mode requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Refusing silent demo fallback.",
    );
  }
}

export function getAppEnvironment(): "demo" | "development" | "test" | "production" {
  if (isDemoMode()) {
    return "demo";
  }
  const nodeEnv = process.env["NODE_ENV"];
  if (nodeEnv === "test") return "test";
  if (nodeEnv === "production") return "production";
  return "development";
}
