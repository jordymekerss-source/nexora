export function isDemoMode(): boolean {
  if (process.env["NEXT_PUBLIC_DEMO_MODE"] === "true") {
    return true;
  }
  if (process.env["NEXT_PUBLIC_DEMO_MODE"] === "false") {
    return false;
  }
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  return url === undefined || url.length === 0 || key === undefined || key.length === 0;
}

export const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_EMPLOYER_ID = "22222222-2222-4222-8222-222222222222";
export const DEMO_EMPLOYEE_IDS = [
  "33333333-3333-4333-8333-333333333331",
  "33333333-3333-4333-8333-333333333332",
  "33333333-3333-4333-8333-333333333333",
] as const;
