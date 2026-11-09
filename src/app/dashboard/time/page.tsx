import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { formatDateTime, formatForDatetimeLocal } from "@/lib/format";
import { computeWorkedMinutes } from "@/lib/time-entry";
import {
  createTimeEntryAction,
  updateOwnPendingTimeEntryAction,
} from "@/app/dashboard/time/actions";
import type { ProfileRow, ProjectRow, TimeEntryRow } from "@/types/database";

export default async function TimeEntriesPage() {
  const { isDemoMode } = await import("@/lib/demo/mode");
  if (isDemoMode()) {
    const { readDemoStore, seedDemoStoreIfEmpty } = await import("@/lib/demo/store");
    await seedDemoStoreIfEmpty(false);
    const store = await readDemoStore();
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-zinc-50">Time</h1>
        <p className="text-sm text-zinc-400">
          Demo-modus toont goedgekeurde uren uit de seed (volledige clock UI vereist Supabase).
        </p>
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-zinc-900">
            {store.timeEntries.map((entry) => (
              <div key={entry.id} className="px-4 py-3 text-sm text-zinc-300">
                <div className="font-medium text-zinc-100">
                  {store.projects.find((project) => project.id === entry.project_id)?.title ??
                    entry.project_id}
                </div>
                <div className="mt-1 text-zinc-500">
                  {entry.status} · break {entry.break_minutes}m
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const { session, tenantId } = await requireDashboardSession();

  if (session.profile.role === "super_admin") {
    redirect("/dashboard");
  }

  if (tenantId === null) {
    redirect("/onboarding/need-tenant");
  }

  const supabase = createSupabaseServerClient();

  const role = session.profile.role;

  const projectQuery =
    role === "employee"
      ? supabase
          .from("projects")
          .select("id, title, status")
          .eq("tenant_id", tenantId)
          .eq("status", "active")
          .order("title", { ascending: true })
          .returns<Pick<ProjectRow, "id" | "title" | "status">[]>()
      : supabase
          .from("projects")
          .select("id, title, status")
          .eq("tenant_id", tenantId)
          .order("title", { ascending: true })
          .returns<Pick<ProjectRow, "id" | "title" | "status">[]>();

  const [{ data: projects }, { data: entries }, { data: memberProfiles }] = await Promise.all([
    projectQuery,
    supabase
      .from("time_entries")
      .select("*")
      .order("clock_in", { ascending: false })
      .returns<TimeEntryRow[]>(),
    role === "employer"
      ? supabase.from("profiles").select("*").eq("tenant_id", tenantId).returns<ProfileRow[]>()
      : Promise.resolve({ data: [] as ProfileRow[] }),
  ]);

  const memberMap = new Map<string, ProfileRow>();
  for (const profile of memberProfiles ?? []) {
    memberMap.set(profile.id, profile);
  }

  const projectOptions = (projects ?? []).map((project) => ({
    value: project.id,
    label: `${project.title} (${project.status})`,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Time</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {role === "employer"
            ? "Review all submitted hours for your organization."
            : "Log hours against active jobs. Pending entries stay editable until approved."}
        </p>
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-zinc-100">Log time</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Use your local timezone; values are stored as UTC timestamps.
        </p>

        <form action={createTimeEntryAction} className="mt-4 space-y-4">
          {projectOptions.length > 0 ? (
            <Select name="project_id" label="Project" required options={projectOptions} />
          ) : (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-400">
              No projects available. Ask your employer to create a project first.
            </div>
          )}
          <Input name="clock_in" type="datetime-local" label="Clock in" required />
          <Input name="clock_out" type="datetime-local" label="Clock out (optional)" />
          <Input name="break_minutes" type="number" min={0} label="Break (minutes)" defaultValue={0} />
          <Textarea name="notes" label="Notes (optional)" rows={3} />
          <Button type="submit" disabled={projectOptions.length === 0}>
            Save entry
          </Button>
        </form>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-semibold text-zinc-100">Entries</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/40 text-xs uppercase text-zinc-500">
              <tr>
                {role === "employer" ? <th className="px-4 py-3">Person</th> : null}
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Clock in</th>
                <th className="px-4 py-3">Clock out</th>
                <th className="px-4 py-3">Break</th>
                <th className="px-4 py-3">Worked</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Notes</th>
                {role === "employee" ? <th className="px-4 py-3 text-right">Edit</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {(entries ?? []).map((entry) => {
                const person = memberMap.get(entry.user_id);
                const label = person?.full_name ?? entry.user_id;
                const projectTitle =
                  projects?.find((project) => project.id === entry.project_id)?.title ?? entry.project_id;
                const worked = computeWorkedMinutes({
                  clockIn: entry.clock_in,
                  clockOut: entry.clock_out,
                  breakMinutes: entry.break_minutes,
                });

                return (
                  <tr key={entry.id} className="text-zinc-300">
                    {role === "employer" ? (
                      <td className="px-4 py-3">{label}</td>
                    ) : null}
                    <td className="px-4 py-3">
                      <Link
                        className="text-accent hover:text-emerald-300"
                        href={`/dashboard/projects/${entry.project_id}`}
                      >
                        {projectTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{formatDateTime(entry.clock_in)}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {entry.clock_out === null ? "—" : formatDateTime(entry.clock_out)}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{entry.break_minutes}m</td>
                    <td className="px-4 py-3 text-zinc-200">{Math.round(worked)}m</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs uppercase text-zinc-400">
                        {entry.status}
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-zinc-400">
                      {entry.notes ?? "—"}
                    </td>
                    {role === "employee" ? (
                      <td className="px-4 py-3 text-right">
                        {entry.status === "pending" && entry.user_id === session.userId ? (
                          <details className="text-left">
                            <summary className="cursor-pointer text-sm text-accent hover:text-emerald-300">
                              Edit
                            </summary>
                            <form action={updateOwnPendingTimeEntryAction} className="mt-3 space-y-3 text-left">
                              <input type="hidden" name="entry_id" value={entry.id} />
                              <input type="hidden" name="project_id" value={entry.project_id} />
                              <Input
                                name="clock_in"
                                type="datetime-local"
                                label="Clock in"
                                required
                                defaultValue={formatForDatetimeLocal(entry.clock_in)}
                              />
                              <Input
                                name="clock_out"
                                type="datetime-local"
                                label="Clock out"
                                defaultValue={
                                  entry.clock_out === null
                                    ? ""
                                    : formatForDatetimeLocal(entry.clock_out)
                                }
                              />
                              <Input
                                name="break_minutes"
                                type="number"
                                min={0}
                                label="Break (minutes)"
                                defaultValue={entry.break_minutes}
                              />
                              <Textarea
                                name="notes"
                                label="Notes"
                                rows={2}
                                defaultValue={entry.notes ?? ""}
                              />
                              <Button type="submit" variant="secondary">
                                Update
                              </Button>
                            </form>
                          </details>
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
        </div>
        {(entries ?? []).length === 0 ? (
          <div className="px-4 py-8 text-sm text-zinc-500">No time entries yet.</div>
        ) : null}
      </Card>
    </div>
  );
}
