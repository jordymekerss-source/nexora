import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoiceBundle } from "@/app/actions/crm_billing";
import { PrintButton } from "@/components/billing/PrintButton";
import { formatDateTime } from "@/lib/format";
import { formatEuro } from "@/lib/money";
import { isUuid } from "@/lib/validation";

type PageProps = {
  params: { id: string };
};

export default async function InvoicePrintPage({ params }: PageProps) {
  if (!isUuid(params.id)) {
    notFound();
  }

  const bundle = await getInvoiceBundle(params.id);
  if (bundle === null) {
    notFound();
  }

  const { invoice, items, tenantName } = bundle;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/employer/invoices/${invoice.id}`} className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Terug naar factuur
        </Link>
        <PrintButton label="Nu afdrukken / PDF" />
      </div>

      <article className="invoice-sheet mx-auto max-w-3xl overflow-hidden rounded-lg border border-zinc-800 bg-white text-zinc-900 shadow-sm">
        <div className="border-b border-zinc-200 bg-zinc-950 px-10 py-8 text-zinc-50">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                NEXORA
              </div>
              <div className="mt-2 text-3xl font-semibold">Business OS</div>
              <div className="mt-2 text-sm text-zinc-300">{tenantName}</div>
            </div>
            <div className="text-right">
              <div className="text-sm uppercase tracking-wide text-zinc-400">Factuur</div>
              <div className="mt-1 text-2xl font-semibold">{invoice.invoice_number}</div>
              <div className="mt-2 text-sm text-zinc-400">{formatDateTime(invoice.created_at)}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-8 px-10 py-8 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Factuur aan
            </div>
            <div className="mt-2 text-lg font-semibold">{invoice.client_name}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Vervaldatum
            </div>
            <div className="mt-2 text-base font-medium">{invoice.due_date}</div>
            <div className="mt-1 text-sm capitalize text-zinc-600">Status: {invoice.status}</div>
          </div>
        </div>

        <div className="px-10 pb-10">
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

          <div className="mt-8 ml-auto w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-zinc-600">
              <span>Subtotaal</span>
              <span>{formatEuro(Number(invoice.subtotal))}</span>
            </div>
            <div className="flex justify-between text-zinc-600">
              <span>BTW</span>
              <span>{formatEuro(Number(invoice.vat_amount))}</span>
            </div>
            <div className="flex justify-between border-t border-zinc-200 pt-2 text-lg font-semibold">
              <span>Totaal</span>
              <span>{formatEuro(Number(invoice.total_amount))}</span>
            </div>
          </div>

          <div className="mt-12 border-t border-zinc-200 pt-4 text-xs text-zinc-500">
            Printklaar NEXORA-document · Geschikt voor PDF-export via de browser.
          </div>
        </div>
      </article>
    </div>
  );
}
