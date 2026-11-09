import {
  convertQuoteFormAction,
  getClients,
  listQuotes,
} from "@/app/actions/crm_billing";
import { QuoteBuilderModal } from "@/components/billing/QuoteBuilderModal";
import { QuoteStatusBadge } from "@/components/billing/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";
import { formatEuro } from "@/lib/money";
import type { QuoteStatus } from "@/types/database";
import Link from "next/link";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

const FILTERS: Array<{ value: "all" | QuoteStatus; label: string }> = [
  { value: "all", label: "Alles" },
  { value: "draft", label: "Concept" },
  { value: "sent", label: "Verzonden" },
  { value: "accepted", label: "Geaccepteerd" },
  { value: "rejected", label: "Afgewezen" },
];

export default async function EmployerQuotesPage({ searchParams }: PageProps) {
  const [quotes, clients] = await Promise.all([listQuotes(), getClients()]);
  const statusParam = searchParams["status"];
  const statusFilter =
    typeof statusParam === "string" &&
    ["draft", "sent", "accepted", "rejected"].includes(statusParam)
      ? (statusParam as QuoteStatus)
      : "all";

  const filtered =
    statusFilter === "all" ? quotes : quotes.filter((quote) => quote.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Offertes</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Pipeline, live BTW-berekening en omzetting naar project + factuur.
          </p>
        </div>
        <QuoteBuilderModal clients={clients} />
      </div>

      {searchParams["created"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Offerte aangemaakt.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const href =
            filter.value === "all"
              ? "/employer/quotes"
              : `/employer/quotes?status=${filter.value}`;
          const active = statusFilter === filter.value;
          return (
            <Link
              key={filter.value}
              href={href}
              className={
                active
                  ? "rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-sm text-accent"
                  : "rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
              }
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/40 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Nummer</th>
                <th className="px-4 py-3">Klant</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Subtotaal</th>
                <th className="px-4 py-3">BTW</th>
                <th className="px-4 py-3">Totaal</th>
                <th className="px-4 py-3">Aangemaakt</th>
                <th className="px-4 py-3 text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {filtered.map((quote) => (
                <tr key={quote.id} className="text-zinc-300">
                  <td className="px-4 py-3 font-medium text-zinc-100">{quote.quote_number}</td>
                  <td className="px-4 py-3">{quote.client_name}</td>
                  <td className="px-4 py-3">
                    <QuoteStatusBadge status={quote.status} />
                  </td>
                  <td className="px-4 py-3">{formatEuro(Number(quote.subtotal))}</td>
                  <td className="px-4 py-3">{formatEuro(Number(quote.vat_amount))}</td>
                  <td className="px-4 py-3 text-accent">
                    {formatEuro(Number(quote.total_amount))}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{formatDateTime(quote.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {quote.status !== "rejected" && quote.status !== "accepted" ? (
                      <form action={convertQuoteFormAction}>
                        <input type="hidden" name="quote_id" value={quote.id} />
                        <Button type="submit">Zet om naar Project & Factuur</Button>
                      </form>
                    ) : quote.status === "accepted" ? (
                      <span className="text-xs text-zinc-500">Omgezet</span>
                    ) : (
                      <span className="text-xs text-zinc-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-sm text-zinc-500">Geen offertes voor dit filter.</div>
        ) : null}
      </Card>
    </div>
  );
}
