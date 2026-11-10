import { redirect } from "next/navigation";
import { DEMO_TENANT_ID, isDemoMode } from "@/lib/demo/mode";
import {
  demoEmailForPersona,
  getDemoPersonaFromCookies,
  getDemoProfileForPersona,
  type DemoPersona,
} from "@/lib/demo/persona";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileRow, ProfileRole } from "@/types/database";

export type AuthenticatedSession = {
  userId: string;
  email: string | null;
  profile: ProfileRow | null;
  role: ProfileRole | "none";
};

function demoSessionFromPersona(
  persona: DemoPersona,
): AuthenticatedSession & { profile: ProfileRow } {
  const profile = getDemoProfileForPersona(persona);
  return {
    userId: profile.id,
    email: demoEmailForPersona(persona),
    profile,
    role: profile.role,
  };
}

export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  if (isDemoMode()) {
    const persona = getDemoPersonaFromCookies();
    if (persona === null) {
      return null;
    }
    return demoSessionFromPersona(persona);
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
    const persona = getDemoPersonaFromCookies();
    if (persona === null) {
      redirect("/login");
    }
    return { session: demoSessionFromPersona(persona), tenantId: DEMO_TENANT_ID };
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
    redirect("/onboarding/create-organization");
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

export async function requireEmployeeSession(): Promise<{
  session: AuthenticatedSession & { profile: ProfileRow };
  tenantId: string;
}> {
  const ctx = await requireDashboardSession();

  if (ctx.session.profile.role !== "employee" || ctx.tenantId === null) {
    redirect("/dashboard");
  }

  return {
    session: ctx.session,
    tenantId: ctx.tenantId,
  };
}
