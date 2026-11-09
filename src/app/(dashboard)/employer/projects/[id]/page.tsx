import Link from "next/link";
import { notFound } from "next/navigation";
import { assignEmployeeFormAction, getEmployerProjectBundle } from "@/app/actions/ops";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { formatDateTime, formatDurationMinutes } from "@/lib/format";
import { isUuid } from "@/lib/validation";

type PageProps = {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function EmployerProjectDetailPage({ params, searchParams }: PageProps) {
  if (!isUuid(params.id)) {
    notFound();
  }

  const bundle = await getEmployerProjectBundle(params.id);
  if (bundle === null) {
    notFound();
  }

  const { project, assignments, activeWorkers, employees, workOrders } = bundle;
  const assignedIds = new Set(assignments.map((row) => row.user_id));
  const assignable = employees.filter((employee) => !assignedIds.has(employee.id));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/employer/projects" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Projecten
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-zinc-50">{project.title}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {project.client_name ?? "—"} · {project.address}
        </p>
      </div>

      {searchParams["assigned"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Medewerker toegewezen.
        </div>
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold text-zinc-100">Nu actief op dit project</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Live overzicht van medewerkers die momenteel zijn ingeklokt.
        </p>
        <div className="mt-4 divide-y divide-zinc-900">
          {activeWorkers.map((worker) => (
            <div key={worker.userId} className="flex items-center justify-between py-3 text-sm">
              <div>
                <div className="font-medium text-zinc-100">{worker.fullName}</div>
                <div className="text-zinc-500">
                  Sinds {formatDateTime(worker.clockIn)}
                  {worker.notes !== null ? ` · ${worker.notes}` : ""}
                </div>
              </div>
              <div className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                {formatDurationMinutes(worker.workedMinutes)}
              </div>
            </div>
          ))}
          {activeWorkers.length === 0 ? (
            <div className="py-6 text-sm text-zinc-500">Niemand is nu ingeklokt.</div>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-zinc-100">Toegewezen team</h2>
          <div className="mt-3 divide-y divide-zinc-900 text-sm">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="py-2 text-zinc-300">
                {assignment.full_name}
              </div>
            ))}
            {assignments.length === 0 ? (
              <div className="py-4 text-zinc-500">Nog niemand toegewezen.</div>
            ) : null}
          </div>

          {assignable.length > 0 ? (
            <form action={assignEmployeeFormAction} className="mt-4 space-y-3">
              <input type="hidden" name="project_id" value={project.id} />
              <Select
                name="user_id"
                label="Medewerker toevoegen"
                required
                options={assignable.map((employee) => ({
                  value: employee.id,
                  label: employee.full_name,
                }))}
              />
              <Button type="submit">Toewijzen</Button>
            </form>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-zinc-100">Werkbonnen</h2>
          <div className="mt-3 space-y-3 text-sm">
            {workOrders.map((order) => (
              <div key={order.id} className="rounded-md border border-zinc-800 p-3">
                <div className="text-zinc-200">{order.work_summary}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {order.completed_at !== null
                    ? `Afgerond ${formatDateTime(order.completed_at)}`
                    : "Concept"}
                </div>
                {order.client_signature_url !== null ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={order.client_signature_url}
                    alt="Klant handtekening"
                    className="mt-2 h-20 rounded border border-zinc-700 bg-white object-contain"
                  />
                ) : null}
              </div>
            ))}
            {workOrders.length === 0 ? (
              <div className="text-zinc-500">Nog geen werkbonnen.</div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
