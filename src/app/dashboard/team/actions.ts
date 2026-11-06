"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
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

  const normalizedEmail = email.trim().toLowerCase();
  const { getSiteUrl } = await import("@/lib/supabase/public-env");
  const siteUrl = getSiteUrl();

  const admin = getSupabaseAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo: `${siteUrl}/auth/callback`,
    data: {
      full_name: fullName.trim(),
      role: "employee",
      tenant_id: ctx.tenantId,
    },
  });

  if (error !== null) {
    redirect("/dashboard/team?error=invite");
  }

  revalidatePath("/dashboard/team");
  redirect("/dashboard/team?invited=1");
}
