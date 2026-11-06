"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getPublicSupabaseAnonKey, getPublicSupabaseUrl } from "@/lib/supabase/public-env";

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(getPublicSupabaseUrl(), getPublicSupabaseAnonKey());
}
