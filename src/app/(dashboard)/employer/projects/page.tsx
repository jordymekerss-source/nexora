import Link from "next/link";
import { listProjectsForEmployer } from "@/app/actions/ops";
import { Card } from "@/components/ui/Card";

export default async function EmployerProjectsPage() {
  const projects = await listProjectsForEmployer();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Projecten</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Multi-user toewijzingen en live actieve medewerkers per project.
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="divide-y divide-surface-border">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/employer/projects/${project.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-surface/50"
            >
              <div>
                <div className="font-medium text-ink">{project.title}</div>
                <div className="text-ink-muted">{project.client_name ?? "—"}</div>
              </div>
              <span className="rounded-full border border-surface-border px-2 py-0.5 text-xs uppercase text-ink-muted">
                {project.status}
              </span>
            </Link>
          ))}
        </div>
        {projects.length === 0 ? (
          <div className="px-4 py-8 text-sm text-ink-muted">Nog geen projecten.</div>
        ) : null}
      </Card>
    </div>
  );
}
