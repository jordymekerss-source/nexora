"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { assertModuleEnabled } from "@/lib/entitlements/check";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateClockRange } from "@/lib/time/validate";
import { isUuid } from "@/lib/validation";

export async function createTimeEntryAction(formData: FormData) {
  const ctx = await requireDashboardSession();
  if (ctx.tenantId === null) {
    redirect("/dashboard/time");
  }
  await assertModuleEnabled(ctx.tenantId, "time");

  const projectId = formData.get("project_id");
  const clockIn = formData.get("clock_in");
  const clockOut = formData.get("clock_out");
  const breakMinutesRaw = formData.get("break_minutes");
  const notes = formData.get("notes");

  if (
    typeof projectId !== "string" ||
    !isUuid(projectId) ||
    typeof clockIn !== "string" ||
    clockIn.length === 0
  ) {
    redirect("/dashboard/time?error=form");
  }

  const clockInIso = new Date(clockIn).toISOString();
  const clockOutValue =
    typeof clockOut === "string" && clockOut.trim().length > 0
      ? new Date(clockOut.trim()).toISOString()
      : null;

  const breakMinutes =
    typeof breakMinutesRaw === "string" && breakMinutesRaw.trim().length > 0
      ? Number.parseInt(breakMinutesRaw, 10)
      : 0;
  const safeBreak = Number.isFinite(breakMinutes) ? Math.max(0, breakMinutes) : 0;

  const issue = validateClockRange({
    clockInIso,
    clockOutIso: clockOutValue,
    breakMinutes: safeBreak,
  });
  if (issue !== null) {
    redirect(`/dashboard/time?error=${issue}`);
  }

  const supabase = createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (project === null) {
    redirect("/dashboard/time?error=project");
  }

  const { error } = await supabase.from("time_entries").insert({
    tenant_id: ctx.tenantId,
    user_id: ctx.session.userId,
    project_id: projectId,
    clock_in: clockInIso,
    clock_out: clockOutValue,
    break_minutes: safeBreak,
    notes: typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null,
    status: "pending",
  });

  if (error !== null) {
    redirect("/dashboard/time?error=db");
  }

  revalidatePath("/dashboard/time");
  revalidatePath(`/dashboard/projects/${projectId}`);
  redirect("/dashboard/time?saved=1");
}

export async function updateOwnPendingTimeEntryAction(formData: FormData) {
  const ctx = await requireDashboardSession();
  if (ctx.tenantId === null) {
    redirect("/dashboard/time");
  }
  await assertModuleEnabled(ctx.tenantId, "time");

  const entryId = formData.get("entry_id");
  const projectId = formData.get("project_id");
  const clockIn = formData.get("clock_in");
  const clockOut = formData.get("clock_out");
  const breakMinutesRaw = formData.get("break_minutes");
  const notes = formData.get("notes");

  if (
    typeof entryId !== "string" ||
    !isUuid(entryId) ||
    typeof projectId !== "string" ||
    !isUuid(projectId) ||
    typeof clockIn !== "string" ||
    clockIn.length === 0
  ) {
    redirect("/dashboard/time?error=form");
  }

  const clockInIso = new Date(clockIn).toISOString();
  const clockOutValue =
    typeof clockOut === "string" && clockOut.trim().length > 0
      ? new Date(clockOut.trim()).toISOString()
      : null;
  const breakMinutes =
    typeof breakMinutesRaw === "string" && breakMinutesRaw.trim().length > 0
      ? Number.parseInt(breakMinutesRaw, 10)
      : 0;
  const safeBreak = Number.isFinite(breakMinutes) ? Math.max(0, breakMinutes) : 0;

  const issue = validateClockRange({
    clockInIso,
    clockOutIso: clockOutValue,
    breakMinutes: safeBreak,
  });
  if (issue !== null) {
    redirect(`/dashboard/time?error=${issue}`);
  }

  const supabase = createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("time_entries")
    .update({
      clock_in: clockInIso,
      clock_out: clockOutValue,
      break_minutes: safeBreak,
      notes: typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null,
    })
    .eq("id", entryId)
    .eq("user_id", ctx.session.userId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending")
    .select("id");

  if (error !== null || updated === null || updated.length === 0) {
    redirect("/dashboard/time?error=forbidden");
  }

  revalidatePath("/dashboard/time");
  revalidatePath(`/dashboard/projects/${projectId}`);
  redirect("/dashboard/time?saved=1");
}
