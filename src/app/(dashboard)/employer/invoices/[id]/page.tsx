import Link from "next/link";
import { notFound } from "next/navigation";
import {
  markInvoiceAsPaidFormAction,
  markInvoiceAsSentFormAction,
} from "@/app/actions/billing";
import { InvoiceStatusBadge } from "@/components/billing/StatusBadge";
import { PrintButton } from "@/components/billing/PrintButton";
import { Button } from "@/components/ui/Button";
import { requireEmployerSession } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/format";
import { formatEuro } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import type { InvoiceItemRow, InvoiceRow, InvoiceStatus, TenantRow } from "@/types/database";

type PageProps = {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
};

function resolveDisplayStatus(invoice: InvoiceRow, today: string): InvoiceStatus {
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

export default async function InvoiceDetailPage({ params, searchParams }: PageProps) {
  const { tenantId } = await requireEmployerSession();

  if (!isUuid(params.id)) {
    notFound();
  }

  const supabase = createSupabaseServerClient();

  const [{ data: invoiceData }, { data: itemsData }, { data: tenantData }] = await Promise.all([
    supabase
      .from("invoices")
      .select("*")
      .eq("id", params.id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase.from("invoice_items").select("*").eq("invoice_id", params.id),
    supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle(),
  ]);

  if (invoiceData === null) {
    notFound();
  }

  const invoice = invoiceData as InvoiceRow;
  const items = (itemsData ?? []) as InvoiceItemRow[];
  const tenant = (tenantData as TenantRow | null) ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const displayStatus = resolveDisplayStatus(invoice, today);

  const paid = searchParams["paid"] === "1";
  const sent = searchParams["sent"] === "1";
  const errorParam = searchParams["error"];
  const error = typeof errorParam === "string" ? errorParam : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/employer/invoices" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Facturen
          </Link>
          <h1 className="mt-3 text-2xl font-semibold text-zinc-50">{invoice.invoice_number}</h1>
          <div className="mt-2">
            <InvoiceStatusBadge status={displayStatus} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton />
          {invoice.status === "draft" ? (
            <form action={markInvoiceAsSentFormAction}>
              <input type="hidden" name="invoice_id" value={invoice.id} />
              <Button type="submit" variant="secondary">
                Markeer als verzonden
              </Button>
            </form>
          ) : null}
          {invoice.status !== "paid" ? (
            <form action={markInvoiceAsPaidFormAction}>
              <input type="hidden" name="invoice_id" value={invoice.id} />
              <Button type="submit">Markeer als betaald</Button>
            </form>
          ) : null}
        </div>
      </div>

      {paid ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200 print:hidden">
          Factuur gemarkeerd als betaald.
        </div>
      ) : null}
      {sent ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200 print:hidden">
          Factuur gemarkeerd als verzonden.
        </div>
      ) : null}
      {error !== undefined ? (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200 print:hidden">
          Actie mislukt ({error}).
        </div>
      ) : null}

      <article className="invoice-sheet overflow-hidden rounded-lg border border-zinc-800 bg-white text-zinc-900 shadow-sm">
        <div className="border-b border-zinc-200 bg-zinc-950 px-8 py-6 text-zinc-50">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                NEXORA
              </div>
              <div className="mt-1 text-2xl font-semibold">Business OS</div>
              <div className="mt-2 text-sm text-zinc-300">{tenant?.name ?? "Organisatie"}</div>
            </div>
            <div className="text-right">
              <div className="text-sm uppercase tracking-wide text-zinc-400">Factuur</div>
              <div className="mt-1 text-xl font-semibold">{invoice.invoice_number}</div>
              <div className="mt-2 text-sm text-zinc-400">
                Datum: {formatDateTime(invoice.created_at)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-8 px-8 py-8 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Factuur aan
            </div>
            <div className="mt-2 text-base font-semibold">{invoice.client_name}</div>
            <div className="text-sm text-zinc-600">{invoice.client_email}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Betaling
            </div>
            <div className="mt-2 text-sm">
              Vervaldatum: <span className="font-medium">{invoice.due_date}</span>
            </div>
            <div className="mt-1 text-sm">
              Status: <span className="font-medium capitalize">{displayStatus}</span>
            </div>
          </div>
        </div>

        <div className="px-8 pb-8">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-2 pr-3">Omschrijving</th>
                <th className="py-2 pr-3 text-right">Aantal</th>
                <th className="py-2 pr-3 text-right">Prijs</th>
                <th className="py-2 text-right">Totaal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-100">
                  <td className="py-3 pr-3">{item.description}</td>
                  <td className="py-3 pr-3 text-right">{Number(item.quantity).toFixed(2)}</td>
                  <td className="py-3 pr-3 text-right">{formatEuro(Number(item.unit_price))}</td>
                  <td className="py-3 text-right font-medium">
                    {formatEuro(Number(item.total_price))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {items.length === 0 ? (
            <div className="py-6 text-sm text-zinc-500">Geen factuurregels.</div>
          ) : null}

          <div className="mt-6 ml-auto w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-zinc-600">
              <span>Subtotaal</span>
              <span>{formatEuro(Number(invoice.subtotal))}</span>
            </div>
            <div className="flex justify-between text-zinc-600">
              <span>BTW</span>
              <span>{formatEuro(Number(invoice.vat_amount))}</span>
            </div>
            <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-semibold">
              <span>Totaal</span>
              <span>{formatEuro(Number(invoice.total_amount))}</span>
            </div>
          </div>

          <div className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-500">
            Gegenereerd via NEXORA Business OS · Bewaar dit document voor uw administratie.
          </div>
        </div>
      </article>
    </div>
  );
}
