import Link from "next/link";
import {
  listInvoices,
  listProjectsForBilling,
} from "@/app/actions/crm_billing";
import { GenerateInvoiceModal } from "@/components/billing/GenerateInvoiceModal";
import { InvoiceStatusBadge } from "@/components/billing/StatusBadge";
import { Card } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";
import { formatEuro, roundMoney } from "@/lib/money";
import type { InvoiceStatus } from "@/types/database";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

function displayStatus(status: InvoiceStatus, dueDate: string, today: string): InvoiceStatus {
  if (status === "paid" || status === "draft") {
    return status;
  }
  if (dueDate < today) {
    return "overdue";
  }
  return status === "overdue" ? "overdue" : "sent";
}

export default async function EmployerInvoicesPage({ searchParams }: PageProps) {
  const [invoices, projects] = await Promise.all([listInvoices(), listProjectsForBilling()]);
  const today = new Date().toISOString().slice(0, 10);

  const withDisplay = invoices.map((invoice) => ({
    ...invoice,
    displayStatus: displayStatus(invoice.status, invoice.due_date, today),
  }));

  const sum = (statuses: readonly InvoiceStatus[]) =>
    roundMoney(
      withDisplay
        .filter((invoice) => statuses.includes(invoice.displayStatus))
        .reduce((sumValue, invoice) => sumValue + Number(invoice.total_amount), 0),
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Facturatie</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Openstaand, betaald en verlopen omzet in één overzicht.
          </p>
        </div>
        <GenerateInvoiceModal projects={projects} />
      </div>

      {typeof searchParams["error"] === "string" ? (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          Factuuractie mislukt ({searchParams["error"]}).
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-ink-muted">Openstaand</div>
          <div className="mt-2 text-2xl font-semibold text-sky-300">{formatEuro(sum(["sent"]))}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-ink-muted">Betaald</div>
          <div className="mt-2 text-2xl font-semibold text-accent">{formatEuro(sum(["paid"]))}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-ink-muted">Verlopen</div>
          <div className="mt-2 text-2xl font-semibold text-amber-300">
            {formatEuro(sum(["overdue"]))}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-surface-border bg-surface/40 text-xs uppercase text-ink-muted">
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
            <tbody className="divide-y divide-surface-border">
              {withDisplay.map((invoice) => (
                <tr key={invoice.id} className="text-ink-muted">
                  <td className="px-4 py-3 font-medium text-ink">{invoice.invoice_number}</td>
                  <td className="px-4 py-3">{invoice.client_name}</td>
                  <td className="px-4 py-3">
                    <InvoiceStatusBadge status={invoice.displayStatus} />
                  </td>
                  <td className="px-4 py-3 text-accent">
                    {formatEuro(Number(invoice.total_amount))}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{invoice.due_date}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatDateTime(invoice.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      className="text-accent hover:text-emerald-300"
                      href={`/employer/invoices/${invoice.id}`}
                    >
                      Open
                    </Link>
                    {" · "}
                    <Link
                      className="text-ink-muted hover:text-ink"
                      href={`/employer/invoices/${invoice.id}/print`}
                    >
                      Print
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {withDisplay.length === 0 ? (
          <div className="px-4 py-10 text-sm text-ink-muted">Nog geen facturen.</div>
        ) : null}
      </Card>
    </div>
  );
}
