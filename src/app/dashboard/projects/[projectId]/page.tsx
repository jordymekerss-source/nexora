import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ProjectPhotoGallery } from "@/components/projects/ProjectPhotoGallery";
import { ProjectPhotoUploader } from "@/components/projects/ProjectPhotoUploader";
import { formatDateTime } from "@/lib/format";
import { computeWorkedMinutes } from "@/lib/time-entry";
import { isUuid } from "@/lib/validation";
import { approveTimeEntryAction, updateProjectAction } from "@/app/dashboard/projects/[projectId]/actions";
import type { ProfileRow, ProjectPhotoRow, ProjectRow, TimeEntryRow } from "@/types/database";

type PageProps = {
  params: { projectId: string };
};

export default async function ProjectDetailPage({ params }: PageProps) {
  const projectId = params.projectId;

  if (!isUuid(projectId)) {
    notFound();
  }

  const ctx = await requireDashboardSession();
  const { session, tenantId } = ctx;

  if (session.profile.role === "super_admin") {
    redirect("/dashboard");
  }

  if (tenantId === null) {
    redirect("/onboarding/need-tenant");
  }

  const supabase = createSupabaseServerClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError !== null || project === null) {
    notFound();
  }

  const typedProject: ProjectRow = project;
  if (typedProject.tenant_id !== tenantId) {
    notFound();
  }

  const [{ data: photos }, { data: timeEntries }, { data: memberProfiles }] = await Promise.all([
    supabase
      .from("project_photos")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .returns<ProjectPhotoRow[]>(),
    supabase
      .from("time_entries")
      .select("*")
      .eq("project_id", projectId)
      .order("clock_in", { ascending: false })
      .returns<TimeEntryRow[]>(),
    session.profile.role === "employer"
      ? supabase.from("profiles").select("*").eq("tenant_id", tenantId).returns<ProfileRow[]>()
      : Promise.resolve({ data: [] satisfies ProfileRow[] }),
  ]);

  const memberMap = new Map<string, ProfileRow>();
  for (const profile of memberProfiles ?? []) {
    memberMap.set(profile.id, profile);
  }

  const canManage = session.profile.role === "employer";
  const canUploadPhotos = session.profile.role === "employee" || session.profile.role === "employer";

  const updateProjectBound = updateProjectAction.bind(null, projectId);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard/projects" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Projects
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-50">{typedProject.title}</h1>
        <p className="mt-2 text-sm text-zinc-400">{typedProject.address}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs uppercase text-zinc-400">
            {typedProject.status}
          </span>
          {typedProject.client_name !== null && typedProject.client_name.length > 0 ? (
            <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
              {typedProject.client_name}
            </span>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <Card>
          <h2 className="text-lg font-semibold text-zinc-100">Edit project</h2>
          <p className="mt-1 text-sm text-zinc-500">Changes apply immediately for your tenant.</p>

          <form action={updateProjectBound} className="mt-4 space-y-4">
            <Input name="title" label="Title" required defaultValue={typedProject.title} />
            <Input
              name="client_name"
              label="Client name"
              defaultValue={typedProject.client_name ?? ""}
            />
            <Input name="address" label="Site address" required defaultValue={typedProject.address} />
            <Select
              name="status"
              label="Status"
              defaultValue={typedProject.status}
              options={[
                { value: "planning", label: "Planning" },
                { value: "active", label: "Active" },
                { value: "completed", label: "Completed" },
              ]}
            />
            <Button type="submit">Save changes</Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold text-zinc-100">Photos</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {canUploadPhotos
            ? "Uploads are private objects; gallery uses short-lived signed URLs."
            : "Photo uploads are available to employees and employers."}
        </p>

        <div className="mt-6 space-y-8">
          {canUploadPhotos ? (
            <ProjectPhotoUploader projectId={projectId} tenantId={tenantId} userId={session.userId} />
          ) : null}
          <ProjectPhotoGallery photos={photos ?? []} />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-zinc-100">Time entries</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {canManage
            ? "Approve entries once payroll is reviewed."
            : "You can edit pending entries until they are approved."}
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-2 pr-4">Person</th>
                <th className="py-2 pr-4">Clock in</th>
                <th className="py-2 pr-4">Clock out</th>
                <th className="py-2 pr-4">Break</th>
                <th className="py-2 pr-4">Worked</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Notes</th>
                {canManage ? <th className="py-2 pl-4 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {(timeEntries ?? []).map((entry) => {
                const person = memberMap.get(entry.user_id);
                const label = person?.full_name ?? entry.user_id;
                const worked = computeWorkedMinutes({
                  clockIn: entry.clock_in,
                  clockOut: entry.clock_out,
                  breakMinutes: entry.break_minutes,
                });

                return (
                  <tr key={entry.id} className="text-zinc-300">
                    <td className="py-3 pr-4">{label}</td>
                    <td className="py-3 pr-4 text-zinc-400">{formatDateTime(entry.clock_in)}</td>
                    <td className="py-3 pr-4 text-zinc-400">
                      {entry.clock_out === null ? "—" : formatDateTime(entry.clock_out)}
                    </td>
                    <td className="py-3 pr-4 text-zinc-400">{entry.break_minutes}m</td>
                    <td className="py-3 pr-4 text-zinc-200">{Math.round(worked)}m</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs uppercase text-zinc-400">
                        {entry.status}
                      </span>
                    </td>
                    <td className="py-3 text-zinc-400">{entry.notes ?? "—"}</td>
                    {canManage ? (
                      <td className="py-3 pl-4 text-right">
                        {entry.status === "pending" ? (
                          <form action={approveTimeEntryAction}>
                            <input type="hidden" name="time_entry_id" value={entry.id} />
                            <input type="hidden" name="project_id" value={projectId} />
                            <Button type="submit" variant="secondary">
                              Approve
                            </Button>
                          </form>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(timeEntries ?? []).length === 0 ? (
            <div className="py-6 text-sm text-zinc-500">No time logged for this job yet.</div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
