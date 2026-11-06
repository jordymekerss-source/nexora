import Link from "next/link";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/Card";
import type { ProjectRow, TenantRow } from "@/types/database";

export default async function DashboardHomePage() {
  const { session, tenantId } = await requireDashboardSession();

  if (session.profile.role === "super_admin") {
    const admin = getSupabaseAdminClient();
    const { data: tenants } = await admin
      .from("tenants")
      .select("id, name, created_at")
      .order("created_at", { ascending: false })
      .returns<TenantRow[]>();

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Platform overview</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Super admins operate across tenants. Tenant users stay scoped by Row Level Security.
          </p>
        </div>

        <Card>
          <h2 className="text-lg font-semibold text-zinc-100">Tenants</h2>
          <p className="mt-1 text-sm text-zinc-500">Latest organizations in the system.</p>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2">Id</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {(tenants ?? []).map((tenant) => (
                  <tr key={tenant.id} className="text-zinc-300">
                    <td className="py-3 pr-4 font-medium text-zinc-100">{tenant.name}</td>
                    <td className="py-3 pr-4 text-zinc-500">
                      {new Date(tenant.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 font-mono text-xs text-zinc-500">{tenant.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 text-sm text-zinc-500">
            Want operational work inside a tenant? Sign in as an employer or employee for that
            organization.
          </div>
        </Card>
      </div>
    );
  }

  if (tenantId === null) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, status, client_name")
    .eq("tenant_id", tenantId)
    .returns<Pick<ProjectRow, "id" | "title" | "status" | "client_name">[]>();

  const { data: tenantData } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  const tenantName =
    tenantData !== null && typeof tenantData === "object" && "name" in tenantData
      ? String((tenantData as { name: string }).name)
      : "Workspace";

  const activeCount =
    projects?.filter((project) => project.status === "active").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          {tenantName}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {session.profile.role === "employer"
            ? "Manage projects, approvals, and your team."
            : "Track time on active jobs and upload site photos."}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Projects</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-50">{projects?.length ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Active</div>
          <div className="mt-2 text-2xl font-semibold text-accent">{activeCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Shortcuts</div>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <Link className="text-accent hover:text-emerald-300" href="/dashboard/projects">
              Projects
            </Link>
            <Link className="text-accent hover:text-emerald-300" href="/dashboard/time">
              Time entries
            </Link>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Recent projects</h2>
            <p className="mt-1 text-sm text-zinc-500">Latest work across your organization.</p>
          </div>
          {session.profile.role === "employer" ? (
            <Link
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500"
              href="/dashboard/projects/new"
            >
              New project
            </Link>
          ) : null}
        </div>

        <div className="mt-4 divide-y divide-zinc-900">
          {(projects ?? []).slice(0, 6).map((project) => (
            <Link
              key={project.id}
              href={`/dashboard/projects/${project.id}`}
              className="flex items-center justify-between py-3 text-sm transition hover:text-white"
            >
              <span className="font-medium text-zinc-100">{project.title}</span>
              <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs uppercase text-zinc-400">
                {project.status}
              </span>
            </Link>
          ))}
          {(projects ?? []).length === 0 ? (
            <div className="py-6 text-sm text-zinc-500">
              No projects yet.{" "}
              {session.profile.role === "employer" ? (
                <Link className="text-accent hover:text-emerald-300" href="/dashboard/projects/new">
                  Create the first project
                </Link>
              ) : (
                "Your employer will create jobs here."
              )}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
