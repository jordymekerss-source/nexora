export function getPublicSupabaseUrl(): string {
  const value = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  if (value === undefined || value.length === 0) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  return value;
}

export function getPublicSupabaseAnonKey(): string {
  const value = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (value === undefined || value.length === 0) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return value;
}

export function getSiteUrl(): string {
  const value = process.env["NEXT_PUBLIC_SITE_URL"];
  if (value === undefined || value.length === 0) {
    return "http://localhost:3000";
  }
  return value;
}
