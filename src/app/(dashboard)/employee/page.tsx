import Link from "next/link";
import {
  clockInFormAction,
  clockOutFormAction,
  endBreakAction,
  getEmployeeMobileBundle,
  startBreakAction,
  uploadDemoProjectPhotoAction,
} from "@/app/actions/ops";
import { PersonaSwitcher } from "@/components/demo/PersonaSwitcher";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
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
  const { assignedProjects, openEntry, openBreak, recentEntries } =
    await getEmployeeMobileBundle();

  const activeProject =
    openEntry === null
      ? null
      : assignedProjects.find((project) => project.id === openEntry.project_id) ?? null;

  return (
    <div className="mx-auto max-w-lg space-y-6" data-testid="employee-mobile-view">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Inklokken</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Hallo {session.profile.full_name}. Kies een toegewezen project en start je dienst.
        </p>
      </div>

      {isDemoMode() ? (
        <Card className="p-4">
          <div className="mb-2 text-xs uppercase text-zinc-500">Demo persona</div>
          <PersonaSwitcher current={getDemoPersonaFromCookies() ?? "employee-0"} />
        </Card>
      ) : null}

      {searchParams["clocked"] === "in" ? (
        <div
          className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200"
          data-testid="clock-in-success"
        >
          Ingeklokt.
        </div>
      ) : null}
      {searchParams["clocked"] === "out" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Uitgeklokt.
        </div>
      ) : null}
      {searchParams["photo"] === "1" ? (
        <div
          className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200"
          data-testid="photo-upload-success"
        >
          Foto geüpload.
        </div>
      ) : null}
      {searchParams["signed"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Werkbon met handtekening opgeslagen.
        </div>
      ) : null}
      {searchParams["break"] === "start" ? (
        <div className="rounded-md border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Pauze gestart (echte pauze-registratie).
        </div>
      ) : null}
      {searchParams["break"] === "end" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Pauze beëindigd en opgeteld bij de dienst.
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
            <div
              className="rounded-md border border-accent/40 bg-accent/10 px-4 py-3"
              data-testid="active-shift-status"
            >
              <div className="text-xs uppercase text-accent">Status</div>
              <div className="mt-1 text-lg font-semibold text-zinc-50">Aan het werk</div>
              <div className="mt-1 font-medium text-zinc-200">
                {activeProject?.title ?? "Project"}
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
            <div className="grid gap-2 sm:grid-cols-2">
              {openBreak === null ? (
                <form action={startBreakAction}>
                  <Button type="submit" className="w-full" variant="secondary">
                    Pauze starten
                  </Button>
                </form>
              ) : (
                <form action={endBreakAction}>
                  <Button type="submit" className="w-full" variant="secondary">
                    Pauze stoppen
                  </Button>
                </form>
              )}
              <form action={clockOutFormAction}>
                <Button
                  type="submit"
                  className="w-full"
                  variant="danger"
                  disabled={openBreak !== null}
                  data-testid="clock-out-button"
                >
                  Uitklokken
                </Button>
              </form>
            </div>
            {openBreak !== null ? (
              <p className="text-xs text-amber-300">
                Pauze actief sinds {formatDateTime(openBreak.break_start)}. Klok eerst de pauze
                uit voordat je uitklokt.
              </p>
            ) : null}

            {isDemoMode() && activeProject !== null ? (
              <form
                action={uploadDemoProjectPhotoAction}
                className="space-y-3 rounded-md border border-zinc-800 p-3"
                data-testid="project-photo-upload"
              >
                <input type="hidden" name="project_id" value={activeProject.id} />
                <div className="text-sm font-medium text-zinc-100">Foto bij actief project</div>
                <Input
                  name="photo"
                  type="file"
                  accept="image/*"
                  label="Afbeelding"
                  required
                  data-testid="project-photo-input"
                />
                <Textarea name="caption" label="Bijschrift (optioneel)" rows={2} />
                <Button type="submit" className="w-full" data-testid="project-photo-submit">
                  Foto uploaden
                </Button>
              </form>
            ) : null}

            <Link
              href={`/employee/work-order?projectId=${openEntry.project_id}`}
              className="inline-flex w-full items-center justify-center rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200"
            >
              Digitale werkbon / handtekening
            </Link>
          </div>
        ) : assignedProjects.length > 0 ? (
          <form action={clockInFormAction} className="space-y-4" data-testid="clock-in-form">
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
            <Button type="submit" className="w-full" data-testid="clock-in-button">
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
