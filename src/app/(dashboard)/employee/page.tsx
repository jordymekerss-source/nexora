import Link from "next/link";
import {
  clockInFormAction,
  clockOutFormAction,
  getEmployeeMobileBundle,
} from "@/app/actions/ops";
import { PersonaSwitcher } from "@/components/demo/PersonaSwitcher";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { requireEmployeeSession } from "@/lib/auth/require-user";
import { isDemoMode } from "@/lib/demo/mode";
import { getDemoPersonaFromCookies } from "@/lib/demo/persona";
import { formatDateTime } from "@/lib/format";
import { computeWorkedMinutes } from "@/lib/time-entry";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function EmployeeMobilePage({ searchParams }: PageProps) {
  const { session } = await requireEmployeeSession();
  const { assignedProjects, openEntry, recentEntries } = await getEmployeeMobileBundle();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Inklokken</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Hallo {session.profile.full_name}. Kies een toegewezen project en start je dienst.
        </p>
      </div>

      {isDemoMode() ? (
        <Card className="p-4">
          <div className="mb-2 text-xs uppercase text-zinc-500">Demo persona</div>
          <PersonaSwitcher current={getDemoPersonaFromCookies()} />
        </Card>
      ) : null}

      {searchParams["clocked"] === "in" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Ingeklokt.
        </div>
      ) : null}
      {searchParams["clocked"] === "out" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Uitgeklokt.
        </div>
      ) : null}
      {searchParams["signed"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Werkbon met handtekening opgeslagen.
        </div>
      ) : null}
      {typeof searchParams["error"] === "string" ? (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          Actie mislukt ({searchParams["error"]}).
        </div>
      ) : null}

      <Card>
        {openEntry !== null ? (
          <div className="space-y-4">
            <div className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3">
              <div className="text-xs uppercase text-accent">Nu actief</div>
              <div className="mt-1 font-medium text-zinc-50">
                {assignedProjects.find((project) => project.id === openEntry.project_id)?.title ??
                  "Project"}
              </div>
              <div className="mt-1 text-sm text-zinc-400">
                Sinds {formatDateTime(openEntry.clock_in)} ·{" "}
                {Math.round(
                  computeWorkedMinutes({
                    clockIn: openEntry.clock_in,
                    clockOut: null,
                    breakMinutes: openEntry.break_minutes,
                  }),
                )}{" "}
                min
              </div>
            </div>
            <form action={clockOutFormAction}>
              <Button type="submit" className="w-full" variant="danger">
                Uitklokken
              </Button>
            </form>
            <Link
              href={`/employee/work-order?projectId=${openEntry.project_id}`}
              className="inline-flex w-full items-center justify-center rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200"
            >
              Digitale werkbon / handtekening
            </Link>
          </div>
        ) : assignedProjects.length > 0 ? (
          <form action={clockInFormAction} className="space-y-4">
            <Select
              name="project_id"
              label="Toegewezen project"
              required
              options={assignedProjects.map((project) => ({
                value: project.id,
                label: project.title,
              }))}
            />
            <Textarea name="notes" label="Notitie (optioneel)" rows={2} />
            <Button type="submit" className="w-full">
              Inklokken
            </Button>
          </form>
        ) : (
          <p className="text-sm text-zinc-500">
            Geen actieve toegewezen projecten. Vraag je werkgever om toewijzing.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-zinc-100">Recente uren</h2>
        <div className="mt-3 divide-y divide-zinc-900">
          {recentEntries.map((entry) => (
            <div key={entry.id} className="py-3 text-sm">
              <div className="font-medium text-zinc-100">
                {assignedProjects.find((project) => project.id === entry.project_id)?.title ??
                  entry.project_id}
              </div>
              <div className="text-zinc-500">
                {formatDateTime(entry.clock_in)}
                {entry.clock_out !== null ? ` → ${formatDateTime(entry.clock_out)}` : " (open)"}
              </div>
            </div>
          ))}
          {recentEntries.length === 0 ? (
            <div className="py-4 text-sm text-zinc-500">Nog geen uren.</div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
