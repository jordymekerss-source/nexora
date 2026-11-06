import Link from "next/link";
import { GenerateInvoiceModal } from "@/components/billing/GenerateInvoiceModal";
import { InvoiceStatusBadge } from "@/components/billing/StatusBadge";
import { Card } from "@/components/ui/Card";
import { requireEmployerSession } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/format";
import { formatEuro, roundMoney } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { InvoiceRow, InvoiceStatus, ProjectRow } from "@/types/database";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

function displayStatus(invoice: InvoiceRow, today: string): InvoiceStatus {
  if (invoice.status === "paid") {
    return "paid";
  }
  if (invoice.status === "draft") {
    return "draft";
  }
  if (invoice.due_date < today) {
    return "overdue";
  }
  return invoice.status === "overdue" ? "overdue" : "sent";
}

export default async function EmployerInvoicesPage({ searchParams }: PageProps) {
  const { tenantId } = await requireEmployerSession();
  const supabase = createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: invoicesData }, { data: projectsData }] = await Promise.all([
    supabase.from("invoices").select("*").order("created_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, title, client_name, status")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "planning", "completed"])
      .order("title", { ascending: true }),
  ]);

  const invoices = (invoicesData ?? []) as InvoiceRow[];
  const projects = (projectsData ?? []) as Array<
    Pick<ProjectRow, "id" | "title" | "client_name" | "status">
  >;

  const withDisplay = invoices.map((invoice) => ({
    ...invoice,
    displayStatus: displayStatus(invoice, today),
  }));

  const sumBy = (statuses: readonly InvoiceStatus[]) =>
    roundMoney(
      withDisplay
        .filter((invoice) => statuses.includes(invoice.displayStatus))
        .reduce((sum, invoice) => sum + Number(invoice.total_amount), 0),
    );

  const draftTotal = sumBy(["draft"]);
  const openTotal = sumBy(["sent"]);
  const paidTotal = sumBy(["paid"]);
  const overdueTotal = sumBy(["overdue"]);

  const errorParam = searchParams["error"];
  const error = typeof errorParam === "string" ? errorParam : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Facturatie</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Overzicht van concept-, openstaande-, betaalde- en vervallen facturen.
          </p>
        </div>
        <GenerateInvoiceModal
          projects={projects.map((project) => ({
            id: project.id,
            title: project.title,
            client_name: project.client_name,
          }))}
        />
      </div>

      {error !== undefined ? (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          Factuuractie mislukt ({error}). Controleer goedgekeurde uren en probeer opnieuw.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Concept</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-50">{formatEuro(draftTotal)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Open</div>
          <div className="mt-2 text-2xl font-semibold text-sky-300">{formatEuro(openTotal)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Betaald</div>
          <div className="mt-2 text-2xl font-semibold text-accent">{formatEuro(paidTotal)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-zinc-500">Vervallen</div>
          <div className="mt-2 text-2xl font-semibold text-amber-300">{formatEuro(overdueTotal)}</div>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/40 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Nummer</th>
                <th className="px-4 py-3">Klant</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Totaal</th>
                <th className="px-4 py-3">Vervaldatum</th>
                <th className="px-4 py-3">Aangemaakt</th>
                <th className="px-4 py-3 text-right">Bekijken</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {withDisplay.map((invoice) => (
                <tr key={invoice.id} className="text-zinc-300">
                  <td className="px-4 py-3 font-medium text-zinc-100">{invoice.invoice_number}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-100">{invoice.client_name}</div>
                    <div className="text-xs text-zinc-500">{invoice.client_email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <InvoiceStatusBadge status={invoice.displayStatus} />
                  </td>
                  <td className="px-4 py-3 text-accent">
                    {formatEuro(Number(invoice.total_amount))}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{invoice.due_date}</td>
                  <td className="px-4 py-3 text-zinc-500">{formatDateTime(invoice.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/employer/invoices/${invoice.id}`}
                      className="text-sm font-medium text-accent hover:text-emerald-300"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {withDisplay.length === 0 ? (
          <div className="px-4 py-10 text-sm text-zinc-500">
            Nog geen facturen. Genereer er een uit goedgekeurde uren.
          </div>
        ) : null}
      </Card>
    </div>
  );
}
