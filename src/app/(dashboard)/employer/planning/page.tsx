import { assignScheduleFormAction, listPlanningBundle } from "@/app/actions/crm_billing";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

function startOfWeek(date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DAY_LABELS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"] as const;

export default async function EmployerPlanningPage({ searchParams }: PageProps) {
  const { schedules, projects, employees } = await listPlanningBundle();
  const weekStart = startOfWeek();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });

  const projectMap = new Map(projects.map((project) => [project.id, project]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Planning</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Weekrooster per medewerker met snelle toewijzing.
        </p>
      </div>

      {searchParams["assigned"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Planning bijgewerkt.
        </div>
      ) : null}
      {typeof searchParams["error"] === "string" ? (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          Toewijzen mislukt ({searchParams["error"]}).
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/50 text-xs uppercase text-zinc-500">
                <th className="px-3 py-3">Medewerker</th>
                {days.map((day, index) => (
                  <th key={ymd(day)} className="px-3 py-3">
                    <div>{DAY_LABELS[index]}</div>
                    <div className="mt-1 font-normal normal-case text-zinc-400">
                      {day.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit" })}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {employees.map((employee) => (
                <tr key={employee.id} className="align-top">
                  <td className="px-3 py-3 font-medium text-zinc-100">{employee.full_name}</td>
                  {days.map((day) => {
                    const key = ymd(day);
                    const daySchedules = schedules.filter(
                      (schedule) =>
                        schedule.assigned_user_id === employee.id &&
                        schedule.scheduled_date === key,
                    );
                    return (
                      <td key={`${employee.id}-${key}`} className="px-2 py-2">
                        <div className="min-h-[88px] space-y-2 rounded-md border border-zinc-800 bg-zinc-950/30 p-2">
                          {daySchedules.map((schedule) => {
                            const project = projectMap.get(schedule.project_id);
                            return (
                              <div
                                key={schedule.id}
                                className="rounded border border-emerald-900/50 bg-emerald-950/20 px-2 py-1.5 text-xs text-emerald-100"
                              >
                                <div className="font-medium">
                                  {project?.title ?? "Project"}
                                </div>
                                <div className="mt-0.5 text-emerald-200/80">
                                  {(schedule.start_time ?? "—").slice(0, 5)} –{" "}
                                  {(schedule.end_time ?? "—").slice(0, 5)}
                                </div>
                              </div>
                            );
                          })}
                          {daySchedules.length === 0 ? (
                            <div className="text-[11px] text-zinc-600">Vrij</div>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {employees.length === 0 ? (
          <div className="px-4 py-8 text-sm text-zinc-500">Geen medewerkers beschikbaar.</div>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-zinc-100">Snelle toewijzing</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Wijs een project toe aan een medewerker op een specifieke dag.
        </p>
        <form action={assignScheduleFormAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          {employees.length > 0 ? (
            <Select
              name="assigned_user_id"
              label="Medewerker"
              required
              options={employees.map((employee) => ({
                value: employee.id,
                label: employee.full_name,
              }))}
            />
          ) : (
            <div className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-500">
              Geen medewerkers
            </div>
          )}
          {projects.length > 0 ? (
            <Select
              name="project_id"
              label="Project"
              required
              options={projects.map((project) => ({
                value: project.id,
                label: project.title,
              }))}
            />
          ) : (
            <div className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-500">
              Geen projecten
            </div>
          )}
          <Input name="scheduled_date" type="date" label="Datum" required defaultValue={ymd(new Date())} />
          <div className="grid grid-cols-2 gap-3">
            <Input name="start_time" type="time" label="Start" defaultValue="08:00" />
            <Input name="end_time" type="time" label="Einde" defaultValue="16:00" />
          </div>
          <div className="sm:col-span-2">
            <Textarea name="notes" label="Notities" rows={2} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={employees.length === 0 || projects.length === 0}>
              Planning toevoegen
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
