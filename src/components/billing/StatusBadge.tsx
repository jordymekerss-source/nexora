import type { InvoiceStatus, QuoteStatus } from "@/types/database";

const quoteStyles: Record<QuoteStatus, string> = {
  draft: "border-zinc-600 text-zinc-300",
  sent: "border-sky-700 text-sky-300",
  accepted: "border-emerald-700 text-emerald-300",
  rejected: "border-red-800 text-red-300",
};

const invoiceStyles: Record<InvoiceStatus, string> = {
  draft: "border-zinc-600 text-zinc-300",
  sent: "border-sky-700 text-sky-300",
  paid: "border-emerald-700 text-emerald-300",
  overdue: "border-amber-700 text-amber-300",
};

const quoteLabels: Record<QuoteStatus, string> = {
  draft: "Concept",
  sent: "Verzonden",
  accepted: "Geaccepteerd",
  rejected: "Afgewezen",
};

const invoiceLabels: Record<InvoiceStatus, string> = {
  draft: "Concept",
  sent: "Open",
  paid: "Betaald",
  overdue: "Vervallen",
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${quoteStyles[status]}`}
    >
      {quoteLabels[status]}
    </span>
  );
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${invoiceStyles[status]}`}
    >
      {invoiceLabels[status]}
    </span>
  );
}
