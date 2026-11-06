import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import type { ProjectRow } from "@/types/database";

export default async function ProjectsListPage() {
  const { session, tenantId } = await requireDashboardSession();

  if (session.profile.role === "super_admin") {
    redirect("/dashboard");
  }

  if (tenantId === null) {
    redirect("/onboarding/need-tenant");
  }

  const supabase = createSupabaseServerClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .returns<ProjectRow[]>();

  const canManage = session.profile.role === "employer";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Projects</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {canManage
              ? "Create jobs, assign work, and track delivery status."
              : "View active projects you can log time against."}
          </p>
        </div>
        {canManage ? (
          <Link
            href="/dashboard/projects/new"
            className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
          >
            New project
          </Link>
        ) : null}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/40 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {(projects ?? []).map((project) => (
                <tr key={project.id} className="text-zinc-300">
                  <td className="px-4 py-3 font-medium text-zinc-100">{project.title}</td>
                  <td className="px-4 py-3 text-zinc-400">{project.client_name ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{project.address}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs uppercase text-zinc-400">
                      {project.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      className="text-sm font-medium text-accent hover:text-emerald-300"
                      href={`/dashboard/projects/${project.id}`}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(projects ?? []).length === 0 ? (
          <div className="px-4 py-8 text-sm text-zinc-500">
            No projects yet.
            {canManage ? (
              <>
                {" "}
                <Link className="text-accent hover:text-emerald-300" href="/dashboard/projects/new">
                  Create one
                </Link>
              </>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
