import Link from "next/link";
import { listProjectsForEmployer } from "@/app/actions/ops";
import { Card } from "@/components/ui/Card";

export default async function EmployerProjectsPage() {
  const projects = await listProjectsForEmployer();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Projecten</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Multi-user toewijzingen en live actieve medewerkers per project.
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="divide-y divide-zinc-900">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/employer/projects/${project.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-zinc-900/50"
            >
              <div>
                <div className="font-medium text-zinc-100">{project.title}</div>
                <div className="text-zinc-500">{project.client_name ?? "—"}</div>
              </div>
              <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs uppercase text-zinc-400">
                {project.status}
              </span>
            </Link>
          ))}
        </div>
        {projects.length === 0 ? (
          <div className="px-4 py-8 text-sm text-zinc-500">Nog geen projecten.</div>
        ) : null}
      </Card>
    </div>
  );
}
