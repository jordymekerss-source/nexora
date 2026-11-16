"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertAuthorized } from "@/lib/authorization/authorize";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { assertModuleEnabled, listEnabledModules } from "@/lib/entitlements/check";
import type { SessionPermissionContext } from "@/lib/permissions/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseBreakMinutes, parseUserDateTime } from "@/lib/time/parse";
import { validateClockRange } from "@/lib/time/validate";
import { isUuid } from "@/lib/validation";

async function permissionContext(): Promise<SessionPermissionContext> {
  const ctx = await requireDashboardSession();
  if (ctx.tenantId === null) {
    redirect("/dashboard/time");
  }
  const modules = await listEnabledModules(ctx.tenantId);
  return {
    userId: ctx.session.userId,
    tenantId: ctx.tenantId,
    role: ctx.session.role === "none" ? "none" : ctx.session.role,
    enabledModules: [...modules],
    enabledFeatures: [],
    actionPermissions: new Map(),
    dataScopes: [],
    supportGrant: null,
  };
}

export async function createTimeEntryAction(formData: FormData) {
  const actor = await permissionContext();
  await assertModuleEnabled(actor.tenantId!, "time");

  const projectId = formData.get("project_id");
  const clockIn = formData.get("clock_in");
  const clockOut = formData.get("clock_out");
  const breakMinutesRaw = formData.get("break_minutes");
  const notes = formData.get("notes");

  if (typeof projectId !== "string" || !isUuid(projectId) || typeof clockIn !== "string") {
    redirect("/dashboard/time?error=form");
  }

  // Module/action first; project assignment is validated against DB below.
  assertAuthorized(
    actor,
    { moduleKey: "time", resourceTenantId: actor.tenantId },
    "create",
  );

  const parsedIn = parseUserDateTime(clockIn);
  if (!parsedIn.ok) {
    redirect("/dashboard/time?error=invalid_clock_in");
  }

  let clockOutValue: string | null = null;
  if (typeof clockOut === "string" && clockOut.trim().length > 0) {
    const parsedOut = parseUserDateTime(clockOut);
    if (!parsedOut.ok) {
      redirect("/dashboard/time?error=invalid_clock_out");
    }
    clockOutValue = parsedOut.iso;
  }

  const parsedBreak = parseBreakMinutes(breakMinutesRaw);
  if (!parsedBreak.ok) {
    redirect(`/dashboard/time?error=${parsedBreak.reason === "negative" ? "negative_break" : "form"}`);
  }

  const issue = validateClockRange({
    clockInIso: parsedIn.iso,
    clockOutIso: clockOutValue,
    breakMinutes: parsedBreak.minutes,
  });
  if (issue !== null) {
    redirect(`/dashboard/time?error=${issue}`);
  }

  const supabase = createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", actor.tenantId!)
    .maybeSingle();
  if (project === null) {
    redirect("/dashboard/time?error=project");
  }

  if (actor.role === "employee") {
    const { data: assignment } = await supabase
      .from("project_assignments")
      .select("id")
      .eq("tenant_id", actor.tenantId!)
      .eq("project_id", projectId)
      .eq("user_id", actor.userId)
      .maybeSingle();
    if (assignment === null) {
      redirect("/dashboard/time?error=forbidden");
    }
  }

  const { error } = await supabase.from("time_entries").insert({
    tenant_id: actor.tenantId!,
    user_id: actor.userId,
    project_id: projectId,
    clock_in: parsedIn.iso,
    clock_out: clockOutValue,
    break_minutes: parsedBreak.minutes,
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
  const actor = await permissionContext();
  await assertModuleEnabled(actor.tenantId!, "time");

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
    typeof clockIn !== "string"
  ) {
    redirect("/dashboard/time?error=form");
  }

  assertAuthorized(
    actor,
    { moduleKey: "time", resourceTenantId: actor.tenantId },
    "edit",
  );

  const parsedIn = parseUserDateTime(clockIn);
  if (!parsedIn.ok) {
    redirect("/dashboard/time?error=invalid_clock_in");
  }

  let clockOutValue: string | null = null;
  if (typeof clockOut === "string" && clockOut.trim().length > 0) {
    const parsedOut = parseUserDateTime(clockOut);
    if (!parsedOut.ok) {
      redirect("/dashboard/time?error=invalid_clock_out");
    }
    clockOutValue = parsedOut.iso;
  }

  const parsedBreak = parseBreakMinutes(breakMinutesRaw);
  if (!parsedBreak.ok) {
    redirect(`/dashboard/time?error=${parsedBreak.reason === "negative" ? "negative_break" : "form"}`);
  }

  const issue = validateClockRange({
    clockInIso: parsedIn.iso,
    clockOutIso: clockOutValue,
    breakMinutes: parsedBreak.minutes,
  });
  if (issue !== null) {
    redirect(`/dashboard/time?error=${issue}`);
  }

  const supabase = createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("time_entries")
    .update({
      clock_in: parsedIn.iso,
      clock_out: clockOutValue,
      break_minutes: parsedBreak.minutes,
      notes: typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null,
    })
    .eq("id", entryId)
    .eq("user_id", actor.userId)
    .eq("tenant_id", actor.tenantId!)
    .eq("status", "pending")
    .select("id");

  if (error !== null || updated === null || updated.length === 0) {
    redirect("/dashboard/time?error=forbidden");
  }

  revalidatePath("/dashboard/time");
  revalidatePath(`/dashboard/projects/${projectId}`);
  redirect("/dashboard/time?saved=1");
}
