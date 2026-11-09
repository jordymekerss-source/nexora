/**
 * Demo mode must be an explicit opt-in.
 * Never treat "missing Supabase env" as permission to run unauthenticated demo in production.
 */
export function isDemoMode(): boolean {
  return process.env["NEXT_PUBLIC_DEMO_MODE"] === "true";
}

export function assertDemoModeAllowed(): void {
  if (!isDemoMode()) {
    return;
  }

  const allowInProduction = process.env["ALLOW_DEMO_IN_PRODUCTION"] === "true";
  if (process.env["NODE_ENV"] === "production" && !allowInProduction) {
    throw new Error(
      "Demo mode is enabled in production without ALLOW_DEMO_IN_PRODUCTION=true. Refusing to start unsafe demo auth.",
    );
  }
}

/** True when the process is intentionally running the public demo host. */
export function isExplicitDemoDeployment(): boolean {
  return isDemoMode() && process.env["ALLOW_DEMO_IN_PRODUCTION"] === "true";
}

export const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_EMPLOYER_ID = "22222222-2222-4222-8222-222222222222";
export const DEMO_EMPLOYEE_IDS = [
  "33333333-3333-4333-8333-333333333331",
  "33333333-3333-4333-8333-333333333332",
  "33333333-3333-4333-8333-333333333333",
] as const;
