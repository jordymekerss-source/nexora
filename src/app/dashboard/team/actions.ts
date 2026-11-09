"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { isDemoMode } from "@/lib/demo/mode";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isNonEmptyString } from "@/lib/validation";

export async function inviteEmployeeAction(formData: FormData) {
  const ctx = await requireDashboardSession();

  if (ctx.session.profile.role !== "employer" || ctx.tenantId === null) {
    redirect("/dashboard/team");
  }

  const email = formData.get("email");
  const fullName = formData.get("full_name");

  if (!isNonEmptyString(email) || !isNonEmptyString(fullName)) {
    redirect("/dashboard/team?error=form");
  }

  if (isDemoMode()) {
    redirect("/dashboard/team?error=demo");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const { getSiteUrl } = await import("@/lib/supabase/public-env");
  const siteUrl = getSiteUrl();

  // 1) Persist authoritative invite bound to THIS employer tenant (RLS-enforced).
  const supabase = createSupabaseServerClient();
  const { error: inviteRowError } = await supabase.from("tenant_invites").insert({
    tenant_id: ctx.tenantId,
    email: normalizedEmail,
    full_name: fullName.trim(),
    invited_by: ctx.session.userId,
  });

  if (inviteRowError !== null) {
    redirect("/dashboard/team?error=invite");
  }

  // 2) Send Auth invite. Profile trigger consumes tenant_invites by email — ignores metadata privileges.
  const admin = getSupabaseAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo: `${siteUrl}/auth/callback`,
    data: {
      full_name: fullName.trim(),
    },
  });

  if (error !== null) {
    await supabase
      .from("tenant_invites")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("email", normalizedEmail)
      .is("consumed_at", null);
    redirect("/dashboard/team?error=invite");
  }

  revalidatePath("/dashboard/team");
  redirect("/dashboard/team?invited=1");
}
