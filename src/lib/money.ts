import { fromCents, toCents, vatCents } from "@/lib/money-cents";

const EUR = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

/** Round via integer eurocents to avoid float drift on VAT/line math. */
export function roundMoney(value: number): number {
  return fromCents(toCents(value));
}

export function lineTotal(quantity: number, unitPrice: number): number {
  const unit = toCents(unitPrice);
  // quantity may be fractional (e.g. 1.5 hours) — round after multiply in cents space
  return fromCents(Math.round(unit * quantity));
}

export function computeVatTotals(params: {
  exclVat: number;
  vatPercentage: number;
}): { exclVat: number; vatAmount: number; inclVat: number } {
  const result = vatCents(toCents(params.exclVat), params.vatPercentage);
  return {
    exclVat: fromCents(result.excl),
    vatAmount: fromCents(result.vat),
    inclVat: fromCents(result.incl),
  };
}

export function formatEuro(amount: number): string {
  return EUR.format(amount);
}

export function parseMoneyInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return roundMoney(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(",", ".");
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return roundMoney(parsed);
}
