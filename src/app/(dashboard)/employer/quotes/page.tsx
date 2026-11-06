import Link from "next/link";
import {
  convertQuoteToProjectFormAction,
  updateQuoteStatusFormAction,
} from "@/app/actions/billing";
import { QuoteBuilderModal } from "@/components/billing/QuoteBuilderModal";
import { QuoteStatusBadge } from "@/components/billing/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireEmployerSession } from "@/lib/auth/require-user";
import { formatDateTime } from "@/lib/format";
import { formatEuro } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { QuoteRow, QuoteStatus } from "@/types/database";

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
  await requireEmployerSession();
  const supabase = createSupabaseServerClient();

  const statusParam = searchParams["status"];
  const statusFilter =
    typeof statusParam === "string" &&
    ["draft", "sent", "accepted", "rejected"].includes(statusParam)
      ? (statusParam as QuoteStatus)
      : "all";

  let query = supabase
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false });

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data: quotesData } = await query;
  const quotes = (quotesData ?? []) as QuoteRow[];

  const created = searchParams["created"] === "1";
  const updated = searchParams["updated"] === "1";
  const errorParam = searchParams["error"];
  const error = typeof errorParam === "string" ? errorParam : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Offertes</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Beheer offertes, bereken BTW en zet geaccepteerde offertes om naar projecten.
          </p>
        </div>
        <QuoteBuilderModal />
      </div>

      {created ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Offerte aangemaakt.
        </div>
      ) : null}
      {updated ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Offertestatus bijgewerkt.
        </div>
      ) : null}
      {error !== undefined ? (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          Actie mislukt ({error}). Controleer de gegevens en probeer opnieuw.
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
                <th className="px-4 py-3">Excl. BTW</th>
                <th className="px-4 py-3">Incl. BTW</th>
                <th className="px-4 py-3">Aangemaakt</th>
                <th className="px-4 py-3 text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {quotes.map((quote) => (
                <tr key={quote.id} className="text-zinc-300">
                  <td className="px-4 py-3 font-medium text-zinc-100">{quote.quote_number}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-100">{quote.client_name}</div>
                    <div className="text-xs text-zinc-500">{quote.client_email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <QuoteStatusBadge status={quote.status} />
                  </td>
                  <td className="px-4 py-3">{formatEuro(Number(quote.total_amount_excl_vat))}</td>
                  <td className="px-4 py-3 text-accent">
                    {formatEuro(Number(quote.total_amount_incl_vat))}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{formatDateTime(quote.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-end gap-2">
                      {quote.status === "draft" || quote.status === "sent" ? (
                        <form action={updateQuoteStatusFormAction} className="flex gap-2">
                          <input type="hidden" name="quote_id" value={quote.id} />
                          {quote.status === "draft" ? (
                            <Button type="submit" name="status" value="sent" variant="secondary">
                              Markeer verzonden
                            </Button>
                          ) : null}
                          {quote.status === "sent" ? (
                            <>
                              <Button type="submit" name="status" value="accepted" variant="secondary">
                                Accepteer
                              </Button>
                              <Button type="submit" name="status" value="rejected" variant="danger">
                                Afwijzen
                              </Button>
                            </>
                          ) : null}
                        </form>
                      ) : null}

                      {(quote.status === "accepted" || quote.status === "sent") && (
                        <form action={convertQuoteToProjectFormAction}>
                          <input type="hidden" name="quote_id" value={quote.id} />
                          <Button type="submit" variant="primary">
                            Zet om naar Project
                          </Button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {quotes.length === 0 ? (
          <div className="px-4 py-10 text-sm text-zinc-500">
            Geen offertes gevonden voor dit filter.
          </div>
        ) : null}
      </Card>
    </div>
  );
}
