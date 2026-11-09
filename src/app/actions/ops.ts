"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  requireDashboardSession,
  requireEmployeeSession,
  requireEmployerSession,
} from "@/lib/auth/require-user";
import { isDemoMode } from "@/lib/demo/mode";
import {
  DEMO_PERSONA_COOKIE,
  parseDemoPersona,
  type DemoPersona,
} from "@/lib/demo/persona";
import { readDemoStore, seedDemoStoreIfEmpty, updateDemoStore } from "@/lib/demo/store";
import { computeWorkedMinutes } from "@/lib/time-entry";
import { isNonEmptyString, isUuid, parseIntSafe } from "@/lib/validation";
import type {
  EmployeeCertificateRow,
  ProjectAssignmentRow,
  ProjectRow,
  TimeEntryRow,
  ToolRow,
  ToolStatus,
  VehicleRow,
  WorkOrderRow,
} from "@/types/database";

function revalidateOps(extra: readonly string[] = []): void {
  const paths = [
    "/employee",
    "/employer/projects",
    "/employer/fleet",
    "/employer/tools",
    "/employer/hr",
    "/dashboard",
    ...extra,
  ];
  for (const path of paths) {
    revalidatePath(path);
  }
}

function isNextRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function switchDemoPersonaAction(formData: FormData): Promise<void> {
  if (!isDemoMode()) {
    redirect("/dashboard");
  }
  const persona = parseDemoPersona(String(formData.get("persona") ?? "employer"));
  cookies().set(DEMO_PERSONA_COOKIE, persona, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
  redirect(persona === "employer" ? "/employer/clients" : "/employee");
}

export async function assignEmployeeToProject(
  projectId: string,
  userId: string,
): Promise<{ assignmentId: string }> {
  const { tenantId } = await requireEmployerSession();
  if (!isUuid(projectId) || !isUuid(userId)) {
    throw new Error("Invalid project or user.");
  }

  if (!isDemoMode()) {
    throw new Error("Live Supabase assignment not configured in this demo worker.");
  }

  let assignmentId = "";
  await updateDemoStore((store) => {
    if (!store.projects.some((project) => project.id === projectId)) {
      throw new Error("Project not found.");
    }
    if (!store.profiles.some((profile) => profile.id === userId && profile.role === "employee")) {
      throw new Error("Employee not found.");
    }
    const existing = store.assignments.find(
      (row) => row.project_id === projectId && row.user_id === userId,
    );
    if (existing !== undefined) {
      assignmentId = existing.id;
      return;
    }
    assignmentId = randomUUID();
    store.assignments.push({
      id: assignmentId,
      tenant_id: tenantId,
      project_id: projectId,
      user_id: userId,
      assigned_at: new Date().toISOString(),
    });
  });

  revalidateOps([`/employer/projects/${projectId}`, "/employee"]);
  return { assignmentId };
}

export async function assignEmployeeFormAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  try {
    await assignEmployeeToProject(projectId, userId);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect(`/employer/projects/${projectId}?error=assign`);
  }
  redirect(`/employer/projects/${projectId}?assigned=1`);
}

export async function clockInOnProject(projectId: string, notes?: string): Promise<{ entryId: string }> {
  const { session, tenantId } = await requireEmployeeSession();
  if (!isUuid(projectId)) {
    throw new Error("Invalid project.");
  }

  if (!isDemoMode()) {
    throw new Error("Live clock-in requires Supabase.");
  }

  let entryId = "";
  await updateDemoStore((store) => {
    const assigned = store.assignments.some(
      (row) => row.project_id === projectId && row.user_id === session.userId,
    );
    if (!assigned) {
      throw new Error("Je bent niet toegewezen aan dit project.");
    }
    const open = store.timeEntries.find(
      (row) => row.user_id === session.userId && row.clock_out === null,
    );
    if (open !== undefined) {
      throw new Error("Je bent al ingeklokt. Klok eerst uit.");
    }
    entryId = randomUUID();
    store.timeEntries.unshift({
      id: entryId,
      tenant_id: tenantId,
      user_id: session.userId,
      project_id: projectId,
      clock_in: new Date().toISOString(),
      clock_out: null,
      break_minutes: 0,
      notes: notes?.trim() || null,
      status: "pending",
    });
  });

  revalidateOps([`/employer/projects/${projectId}`, "/employee"]);
  return { entryId };
}

export async function clockOutCurrent(): Promise<void> {
  const { session } = await requireEmployeeSession();
  if (!isDemoMode()) {
    throw new Error("Live clock-out requires Supabase.");
  }

  await updateDemoStore((store) => {
    const open = store.timeEntries.find(
      (row) => row.user_id === session.userId && row.clock_out === null,
    );
    if (open === undefined) {
      throw new Error("Geen open inkloksessie gevonden.");
    }
    open.clock_out = new Date().toISOString();
  });

  revalidateOps(["/employee"]);
}

export async function clockInFormAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  const notes = String(formData.get("notes") ?? "");
  try {
    await clockInOnProject(projectId, notes);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect(`/employee?error=clockin`);
  }
  redirect("/employee?clocked=in");
}

export async function clockOutFormAction(): Promise<void> {
  try {
    await clockOutCurrent();
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect("/employee?error=clockout");
  }
  redirect("/employee?clocked=out");
}

export async function startBreakAction(): Promise<void> {
  const { session, tenantId } = await requireEmployeeSession();
  if (!isDemoMode()) {
    redirect("/employee?error=mode");
  }

  try {
    await updateDemoStore((store) => {
      const open = store.timeEntries.find(
        (row) => row.user_id === session.userId && row.clock_out === null,
      );
      if (open === undefined) {
        throw new Error("Geen open dienst.");
      }
      const openBreak = store.breakEntries.find(
        (row) => row.time_entry_id === open.id && row.break_end === null,
      );
      if (openBreak !== undefined) {
        throw new Error("Pauze loopt al.");
      }
      store.breakEntries.unshift({
        id: randomUUID(),
        tenant_id: tenantId,
        time_entry_id: open.id,
        user_id: session.userId,
        break_start: new Date().toISOString(),
        break_end: null,
        notes: null,
        created_at: new Date().toISOString(),
      });
      store.auditEvents.unshift({
        id: randomUUID(),
        tenant_id: tenantId,
        actor_user_id: session.userId,
        action: "break.started",
        entity_type: "time_entry",
        entity_id: open.id,
        metadata: {},
        created_at: new Date().toISOString(),
      });
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect("/employee?error=break");
  }
  revalidateOps(["/employee"]);
  redirect("/employee?break=start");
}

export async function endBreakAction(): Promise<void> {
  const { session, tenantId } = await requireEmployeeSession();
  if (!isDemoMode()) {
    redirect("/employee?error=mode");
  }

  try {
    await updateDemoStore((store) => {
      const open = store.timeEntries.find(
        (row) => row.user_id === session.userId && row.clock_out === null,
      );
      if (open === undefined) {
        throw new Error("Geen open dienst.");
      }
      const openBreak = store.breakEntries.find(
        (row) => row.time_entry_id === open.id && row.break_end === null,
      );
      if (openBreak === undefined) {
        throw new Error("Geen open pauze.");
      }
      const end = new Date();
      openBreak.break_end = end.toISOString();
      const elapsed = Math.max(
        0,
        Math.round((end.getTime() - new Date(openBreak.break_start).getTime()) / 60000),
      );
      open.break_minutes += elapsed;
      store.auditEvents.unshift({
        id: randomUUID(),
        tenant_id: tenantId,
        actor_user_id: session.userId,
        action: "break.ended",
        entity_type: "time_entry",
        entity_id: open.id,
        metadata: { minutes: elapsed },
        created_at: new Date().toISOString(),
      });
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect("/employee?error=break");
  }
  revalidateOps(["/employee"]);
  redirect("/employee?break=end");
}

export async function getEmployeeMobileBundle(): Promise<{
  assignedProjects: ProjectRow[];
  openEntry: TimeEntryRow | null;
  openBreak: { id: string; break_start: string } | null;
  recentEntries: TimeEntryRow[];
}> {
  const { session } = await requireEmployeeSession();
  if (isDemoMode()) {
    await seedDemoStoreIfEmpty(false);
    const store = await readDemoStore();
    const assignedIds = new Set(
      store.assignments
        .filter((row) => row.user_id === session.userId)
        .map((row) => row.project_id),
    );
    const assignedProjects = store.projects.filter(
      (project) => assignedIds.has(project.id) && project.status === "active",
    );
    const openEntry =
      store.timeEntries.find(
        (row) => row.user_id === session.userId && row.clock_out === null,
      ) ?? null;
    const openBreakRow =
      openEntry === null
        ? undefined
        : store.breakEntries.find(
            (row) => row.time_entry_id === openEntry.id && row.break_end === null,
          );
    const recentEntries = store.timeEntries
      .filter((row) => row.user_id === session.userId)
      .slice(0, 8);
    return {
      assignedProjects,
      openEntry,
      openBreak:
        openBreakRow === undefined
          ? null
          : { id: openBreakRow.id, break_start: openBreakRow.break_start },
      recentEntries,
    };
  }
  return { assignedProjects: [], openEntry: null, openBreak: null, recentEntries: [] };
}

export async function getEmployerProjectBundle(projectId: string): Promise<{
  project: ProjectRow;
  assignments: Array<ProjectAssignmentRow & { full_name: string }>;
  activeWorkers: Array<{
    userId: string;
    fullName: string;
    clockIn: string;
    workedMinutes: number;
    notes: string | null;
  }>;
  employees: Array<{ id: string; full_name: string }>;
  workOrders: WorkOrderRow[];
} | null> {
  await requireEmployerSession();
  if (!isUuid(projectId)) {
    return null;
  }
  if (!isDemoMode()) {
    return null;
  }
  await seedDemoStoreIfEmpty(false);
  const store = await readDemoStore();
  const project = store.projects.find((row) => row.id === projectId) ?? null;
  if (project === null) {
    return null;
  }

  const profileMap = new Map(store.profiles.map((profile) => [profile.id, profile]));
  const assignments = store.assignments
    .filter((row) => row.project_id === projectId)
    .map((row) => ({
      ...row,
      full_name: profileMap.get(row.user_id)?.full_name ?? row.user_id,
    }));

  const activeWorkers = store.timeEntries
    .filter((row) => row.project_id === projectId && row.clock_out === null)
    .map((row) => ({
      userId: row.user_id,
      fullName: profileMap.get(row.user_id)?.full_name ?? row.user_id,
      clockIn: row.clock_in,
      workedMinutes: computeWorkedMinutes({
        clockIn: row.clock_in,
        clockOut: null,
        breakMinutes: row.break_minutes,
      }),
      notes: row.notes,
    }));

  return {
    project,
    assignments,
    activeWorkers,
    employees: store.profiles
      .filter((profile) => profile.role === "employee")
      .map((profile) => ({ id: profile.id, full_name: profile.full_name })),
    workOrders: store.workOrders.filter((row) => row.project_id === projectId),
  };
}

export async function listProjectsForEmployer(): Promise<ProjectRow[]> {
  await requireEmployerSession();
  if (!isDemoMode()) return [];
  await seedDemoStoreIfEmpty(false);
  return (await readDemoStore()).projects;
}

export async function createVehicleFormAction(formData: FormData): Promise<void> {
  const { tenantId } = await requireEmployerSession();
  if (!isDemoMode()) redirect("/employer/fleet?error=mode");

  const licensePlate = String(formData.get("license_plate") ?? "").trim().toUpperCase();
  const brandModel = String(formData.get("brand_model") ?? "").trim();
  const apk = String(formData.get("apk_expiry_date") ?? "").trim();
  const km = parseIntSafe(formData.get("km_status"), 0);
  const assigned = String(formData.get("assigned_user_id") ?? "").trim();

  if (!isNonEmptyString(licensePlate) || !isNonEmptyString(brandModel)) {
    redirect("/employer/fleet?error=form");
  }

  await updateDemoStore((store) => {
    store.vehicles.unshift({
      id: randomUUID(),
      tenant_id: tenantId,
      license_plate: licensePlate,
      brand_model: brandModel,
      apk_expiry_date: apk.length > 0 ? apk : null,
      km_status: Math.max(0, km),
      assigned_user_id: isUuid(assigned) ? assigned : null,
      created_at: new Date().toISOString(),
    });
  });
  revalidateOps(["/employer/fleet"]);
  redirect("/employer/fleet?created=1");
}

export async function createToolFormAction(formData: FormData): Promise<void> {
  const { tenantId } = await requireEmployerSession();
  if (!isDemoMode()) redirect("/employer/tools?error=mode");

  const name = String(formData.get("name") ?? "").trim();
  const serial = String(formData.get("serial_number") ?? "").trim();
  const status = String(formData.get("status") ?? "active") as ToolStatus;
  const checkedOut = String(formData.get("checked_out_to_user_id") ?? "").trim();

  if (!isNonEmptyString(name)) {
    redirect("/employer/tools?error=form");
  }
  if (!["active", "maintenance", "broken"].includes(status)) {
    redirect("/employer/tools?error=status");
  }

  await updateDemoStore((store) => {
    store.tools.unshift({
      id: randomUUID(),
      tenant_id: tenantId,
      name,
      serial_number: serial.length > 0 ? serial : null,
      status,
      checked_out_to_user_id: isUuid(checkedOut) ? checkedOut : null,
      created_at: new Date().toISOString(),
    });
  });
  revalidateOps(["/employer/tools"]);
  redirect("/employer/tools?created=1");
}

export async function createCertificateFormAction(formData: FormData): Promise<void> {
  const { tenantId } = await requireEmployerSession();
  if (!isDemoMode()) redirect("/employer/hr?error=mode");

  const userId = String(formData.get("user_id") ?? "");
  const certificateName = String(formData.get("certificate_name") ?? "").trim();
  const expiryDate = String(formData.get("expiry_date") ?? "").trim();
  const documentUrl = String(formData.get("document_url") ?? "").trim();

  if (!isUuid(userId) || !isNonEmptyString(certificateName) || !isNonEmptyString(expiryDate)) {
    redirect("/employer/hr?error=form");
  }

  await updateDemoStore((store) => {
    store.certificates.unshift({
      id: randomUUID(),
      tenant_id: tenantId,
      user_id: userId,
      certificate_name: certificateName,
      expiry_date: expiryDate,
      document_url: documentUrl.length > 0 ? documentUrl : null,
      created_at: new Date().toISOString(),
    });
  });
  revalidateOps(["/employer/hr"]);
  redirect("/employer/hr?created=1");
}

export async function completeWorkOrderWithSignature(input: {
  projectId: string;
  workSummary: string;
  signatureDataUrl: string;
}): Promise<{ workOrderId: string }> {
  const ctx = await requireDashboardSession();
  if (ctx.tenantId === null) {
    throw new Error("No tenant.");
  }
  if (!isUuid(input.projectId) || !isNonEmptyString(input.workSummary)) {
    throw new Error("Project and summary are required.");
  }
  if (!input.signatureDataUrl.startsWith("data:image/")) {
    throw new Error("Handtekening ontbreekt.");
  }
  if (!isDemoMode()) {
    throw new Error("Live work orders require Supabase.");
  }

  let workOrderId = "";
  await updateDemoStore((store) => {
    if (ctx.session.profile.role === "employee") {
      const assigned = store.assignments.some(
        (row) => row.project_id === input.projectId && row.user_id === ctx.session.userId,
      );
      if (!assigned) {
        throw new Error("Niet toegewezen aan dit project.");
      }
    }
    workOrderId = randomUUID();
    store.workOrders.unshift({
      id: workOrderId,
      tenant_id: ctx.tenantId!,
      project_id: input.projectId,
      client_signature_url: input.signatureDataUrl,
      work_summary: input.workSummary.trim(),
      completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      created_by: ctx.session.userId,
    });
  });

  revalidateOps([`/employer/projects/${input.projectId}`, "/employee"]);
  return { workOrderId };
}

export async function completeWorkOrderFormAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id") ?? "");
  const workSummary = String(formData.get("work_summary") ?? "");
  const signatureDataUrl = String(formData.get("signature_data_url") ?? "");
  try {
    await completeWorkOrderWithSignature({ projectId, workSummary, signatureDataUrl });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirect(`/employee/work-order?projectId=${projectId}&error=sign`);
  }
  redirect(`/employee?signed=1`);
}

export async function updateVehicleFormAction(formData: FormData): Promise<void> {
  await requireEmployerSession();
  if (!isDemoMode()) redirect("/employer/fleet?error=mode");

  const id = String(formData.get("id") ?? "");
  const km = parseIntSafe(formData.get("km_status"), 0);
  const assigned = String(formData.get("assigned_user_id") ?? "").trim();

  if (!isUuid(id)) {
    redirect("/employer/fleet?error=form");
  }

  await updateDemoStore((store) => {
    const vehicle = store.vehicles.find((row) => row.id === id);
    if (vehicle === undefined) {
      throw new Error("Vehicle not found.");
    }
    vehicle.km_status = Math.max(0, km);
    vehicle.assigned_user_id = isUuid(assigned) ? assigned : null;
  });
  revalidateOps(["/employer/fleet"]);
  redirect("/employer/fleet?updated=1");
}

export async function updateToolStatusFormAction(formData: FormData): Promise<void> {
  await requireEmployerSession();
  if (!isDemoMode()) redirect("/employer/tools?error=mode");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "active") as ToolStatus;
  if (!isUuid(id) || !["active", "maintenance", "broken"].includes(status)) {
    redirect("/employer/tools?error=form");
  }

  await updateDemoStore((store) => {
    const tool = store.tools.find((row) => row.id === id);
    if (tool === undefined) {
      throw new Error("Tool not found.");
    }
    tool.status = status;
  });
  revalidateOps(["/employer/tools"]);
  redirect("/employer/tools?updated=1");
}

export async function checkoutToolFormAction(formData: FormData): Promise<void> {
  await requireEmployerSession();
  if (!isDemoMode()) redirect("/employer/tools?error=mode");

  const id = String(formData.get("id") ?? "");
  const checkedOut = String(formData.get("checked_out_to_user_id") ?? "").trim();
  if (!isUuid(id)) {
    redirect("/employer/tools?error=form");
  }

  await updateDemoStore((store) => {
    const tool = store.tools.find((row) => row.id === id);
    if (tool === undefined) {
      throw new Error("Tool not found.");
    }
    tool.checked_out_to_user_id = isUuid(checkedOut) ? checkedOut : null;
  });
  revalidateOps(["/employer/tools"]);
  redirect("/employer/tools?updated=1");
}

export async function getFleetBundle(): Promise<{
  vehicles: Array<VehicleRow & { assigned_user_name: string | null }>;
  employees: Array<{ id: string; full_name: string }>;
}> {
  await requireEmployerSession();
  if (!isDemoMode()) return { vehicles: [], employees: [] };
  await seedDemoStoreIfEmpty(false);
  const store = await readDemoStore();
  const profileMap = new Map(store.profiles.map((profile) => [profile.id, profile.full_name]));
  return {
    vehicles: store.vehicles.map((vehicle) => ({
      ...vehicle,
      assigned_user_name:
        vehicle.assigned_user_id !== null
          ? (profileMap.get(vehicle.assigned_user_id) ?? null)
          : null,
    })),
    employees: store.profiles
      .filter((profile) => profile.role === "employee")
      .map((profile) => ({ id: profile.id, full_name: profile.full_name })),
  };
}

export async function getToolsBundle(): Promise<{
  tools: Array<ToolRow & { checked_out_to_name: string | null }>;
  employees: Array<{ id: string; full_name: string }>;
}> {
  await requireEmployerSession();
  if (!isDemoMode()) return { tools: [], employees: [] };
  await seedDemoStoreIfEmpty(false);
  const store = await readDemoStore();
  const profileMap = new Map(store.profiles.map((profile) => [profile.id, profile.full_name]));
  return {
    tools: store.tools.map((tool) => ({
      ...tool,
      checked_out_to_name:
        tool.checked_out_to_user_id !== null
          ? (profileMap.get(tool.checked_out_to_user_id) ?? null)
          : null,
    })),
    employees: store.profiles
      .filter((profile) => profile.role === "employee")
      .map((profile) => ({ id: profile.id, full_name: profile.full_name })),
  };
}

export async function getHrBundle(): Promise<{
  certificates: Array<EmployeeCertificateRow & { user_name: string }>;
  employees: Array<{ id: string; full_name: string }>;
}> {
  await requireEmployerSession();
  if (!isDemoMode()) return { certificates: [], employees: [] };
  await seedDemoStoreIfEmpty(false);
  const store = await readDemoStore();
  const profileMap = new Map(store.profiles.map((profile) => [profile.id, profile.full_name]));
  return {
    certificates: store.certificates.map((certificate) => ({
      ...certificate,
      user_name: profileMap.get(certificate.user_id) ?? certificate.user_id,
    })),
    employees: store.profiles
      .filter((profile) => profile.role === "employee")
      .map((profile) => ({ id: profile.id, full_name: profile.full_name })),
  };
}

export type { DemoPersona };
