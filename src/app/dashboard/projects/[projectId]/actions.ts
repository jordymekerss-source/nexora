"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isNonEmptyString, isUuid } from "@/lib/validation";
import type { ProjectStatus, TimeEntryStatus } from "@/types/database";

export async function updateProjectAction(projectId: string, formData: FormData) {
  const ctx = await requireDashboardSession();
  if (ctx.session.profile.role !== "employer" || ctx.tenantId === null) {
    redirect("/dashboard/projects");
  }

  if (!isUuid(projectId)) {
    redirect("/dashboard/projects");
  }

  const title = formData.get("title");
  const clientName = formData.get("client_name");
  const address = formData.get("address");
  const status = formData.get("status");

  if (!isNonEmptyString(title) || !isNonEmptyString(address) || typeof status !== "string") {
    redirect(`/dashboard/projects/${projectId}?error=form`);
  }

  const normalizedStatus = status as ProjectStatus;
  if (!["planning", "active", "completed"].includes(normalizedStatus)) {
    redirect(`/dashboard/projects/${projectId}?error=status`);
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .update({
      title: title.trim(),
      client_name:
        typeof clientName === "string" && clientName.trim().length > 0
          ? clientName.trim()
          : null,
      address: address.trim(),
      status: normalizedStatus,
    })
    .eq("id", projectId)
    .eq("tenant_id", ctx.tenantId);

  if (error !== null) {
    redirect(`/dashboard/projects/${projectId}?error=db`);
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard/projects");
}

export async function approveTimeEntryAction(formData: FormData) {
  const ctx = await requireDashboardSession();
  if (ctx.session.profile.role !== "employer" || ctx.tenantId === null) {
    redirect("/dashboard/projects");
  }

  const timeEntryId = formData.get("time_entry_id");
  const projectId = formData.get("project_id");

  if (typeof timeEntryId !== "string" || !isUuid(timeEntryId)) {
    redirect("/dashboard/projects");
  }
  if (typeof projectId !== "string" || !isUuid(projectId)) {
    redirect("/dashboard/projects");
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("time_entries")
    .update({ status: "approved" satisfies TimeEntryStatus })
    .eq("id", timeEntryId)
    .eq("tenant_id", ctx.tenantId)
    .eq("project_id", projectId);

  if (error !== null) {
    redirect(`/dashboard/projects/${projectId}?error=approve`);
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
}
