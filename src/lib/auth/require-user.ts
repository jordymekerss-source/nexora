import { redirect } from "next/navigation";
import {
  DEMO_EMPLOYER_ID,
  DEMO_TENANT_ID,
  isDemoMode,
} from "@/lib/demo/mode";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow, ProfileRole } from "@/types/database";

export type AuthenticatedSession = {
  userId: string;
  email: string | null;
  profile: ProfileRow | null;
  role: ProfileRole | "none";
};

function demoEmployerSession(): AuthenticatedSession & { profile: ProfileRow } {
  const profile: ProfileRow = {
    id: DEMO_EMPLOYER_ID,
    tenant_id: DEMO_TENANT_ID,
    full_name: "Demo Werkgever",
    role: "employer",
    phone: "+31 6 1234 5678",
    created_at: new Date().toISOString(),
  };

  return {
    userId: DEMO_EMPLOYER_ID,
    email: "demo@nexora.local",
    profile,
    role: "employer",
  };
}

export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  if (isDemoMode()) {
    return demoEmployerSession();
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error !== null || user === null) {
    return null;
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (profileData as ProfileRow | null) ?? null;
  const role: ProfileRole | "none" = profile?.role ?? "none";

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    role,
  };
}

export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getAuthenticatedSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

export type DashboardSession =
  | {
      session: AuthenticatedSession & { profile: ProfileRow };
      tenantId: string;
    }
  | {
      session: AuthenticatedSession & { profile: ProfileRow };
      tenantId: null;
    };

export async function requireDashboardSession(): Promise<DashboardSession> {
  if (isDemoMode()) {
    const session = demoEmployerSession();
    return { session, tenantId: DEMO_TENANT_ID };
  }

  const session = await requireSession();

  if (session.profile === null) {
    redirect("/onboarding/bootstrap-profile");
  }

  const profile = session.profile;

  if (profile.role === "super_admin") {
    return { session: { ...session, profile }, tenantId: null };
  }

  if (profile.tenant_id === null) {
    if (profile.role === "employer") {
      redirect("/onboarding/create-organization");
    }
    redirect("/onboarding/need-tenant");
  }

  return { session: { ...session, profile }, tenantId: profile.tenant_id };
}

export async function requireEmployerSession(): Promise<{
  session: AuthenticatedSession & { profile: ProfileRow };
  tenantId: string;
}> {
  const ctx = await requireDashboardSession();

  if (ctx.session.profile.role !== "employer" || ctx.tenantId === null) {
    redirect("/dashboard");
  }

  return {
    session: ctx.session,
    tenantId: ctx.tenantId,
  };
}
