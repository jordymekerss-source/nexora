import Link from "next/link";
import { redirect } from "next/navigation";
import { seedDemoDataFormAction } from "@/app/actions/crm_billing";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { isDemoMode } from "@/lib/demo/mode";
import { readDemoStore, seedDemoStoreIfEmpty } from "@/lib/demo/store";
import { formatEuro, roundMoney } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProjectRow, TenantRow } from "@/types/database";

export default async function DashboardHomePage() {
  if (isDemoMode()) {
    await seedDemoStoreIfEmpty(false);
    const store = await readDemoStore();
    const open = roundMoney(
      store.invoices
        .filter((invoice) => invoice.status === "sent" || invoice.status === "overdue")
        .reduce((sum, invoice) => sum + Number(invoice.total_amount), 0),
    );

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">{store.tenantName}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Demo modus actief — alle CRM-, offerte-, factuur- en planningdata staat klaar.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs uppercase text-zinc-500">Klanten</div>
            <div className="mt-2 text-2xl font-semibold">{store.clients.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase text-zinc-500">Offertes</div>
            <div className="mt-2 text-2xl font-semibold">{store.quotes.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase text-zinc-500">Openstaand</div>
            <div className="mt-2 text-2xl font-semibold text-accent">{formatEuro(open)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase text-zinc-500">Planning</div>
            <div className="mt-2 text-2xl font-semibold">{store.schedules.length}</div>
          </Card>
        </div>

        <Card>
          <h2 className="text-lg font-semibold text-zinc-100">Snel naar modules</h2>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link className="text-accent hover:text-emerald-300" href="/employer/clients">
              Klanten
            </Link>
            <Link className="text-accent hover:text-emerald-300" href="/employer/quotes">
              Offertes
            </Link>
            <Link className="text-accent hover:text-emerald-300" href="/employer/invoices">
              Facturen
            </Link>
            <Link className="text-accent hover:text-emerald-300" href="/employer/planning">
              Planning
            </Link>
          </div>
          <form action={seedDemoDataFormAction} className="mt-6">
            <input type="hidden" name="force" value="1" />
            <Button type="submit" variant="secondary">
              Demo data opnieuw laden
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const { session, tenantId } = await requireDashboardSession();

  if (session.profile.role === "super_admin") {
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const admin = getSupabaseAdminClient();
    const { data: tenants } = await admin
      .from("tenants")
      .select("id, name, created_at")
      .order("created_at", { ascending: false })
      .returns<TenantRow[]>();

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-zinc-50">Platform overview</h1>
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2">Id</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {(tenants ?? []).map((tenant) => (
                  <tr key={tenant.id}>
                    <td className="py-3 pr-4">{tenant.name}</td>
                    <td className="py-3 font-mono text-xs text-zinc-500">{tenant.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  if (tenantId === null) {
    redirect("/onboarding/need-tenant");
  }

  const supabase = createSupabaseServerClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, status, client_name")
    .eq("tenant_id", tenantId)
    .returns<Pick<ProjectRow, "id" | "title" | "status" | "client_name">[]>();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-50">Workspace</h1>
      <Card>
        <div className="divide-y divide-zinc-900">
          {(projects ?? []).slice(0, 8).map((project) => (
            <Link
              key={project.id}
              href={`/dashboard/projects/${project.id}`}
              className="flex items-center justify-between py-3 text-sm"
            >
              <span>{project.title}</span>
              <span className="text-xs uppercase text-zinc-500">{project.status}</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
