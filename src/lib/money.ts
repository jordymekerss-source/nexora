const EUR = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function lineTotal(quantity: number, unitPrice: number): number {
  return roundMoney(quantity * unitPrice);
}

export function computeVatTotals(params: {
  exclVat: number;
  vatPercentage: number;
}): { exclVat: number; vatAmount: number; inclVat: number } {
  const exclVat = roundMoney(params.exclVat);
  const vatAmount = roundMoney((exclVat * params.vatPercentage) / 100);
  const inclVat = roundMoney(exclVat + vatAmount);
  return { exclVat, vatAmount, inclVat };
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
