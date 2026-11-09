import { isDemoMode } from "@/lib/demo/mode";

export function getPublicSupabaseUrl(): string {
  if (isDemoMode()) {
    return process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "https://demo.supabase.local";
  }
  const value = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  if (value === undefined || value.length === 0) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  return value;
}

export function getPublicSupabaseAnonKey(): string {
  if (isDemoMode()) {
    return process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "demo-anon-key";
  }
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
