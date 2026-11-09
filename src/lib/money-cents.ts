/** Exact EUR amounts as integer eurocents (FIN-001 target representation). */

export type Cents = number & { readonly __brand: "Cents" };

export function toCents(euros: number): Cents {
  if (!Number.isFinite(euros)) {
    throw new Error("Invalid money value.");
  }
  return Math.round(euros * 100) as Cents;
}

export function fromCents(cents: Cents | number): number {
  return cents / 100;
}

export function addCents(a: Cents | number, b: Cents | number): Cents {
  return (Math.trunc(a) + Math.trunc(b)) as Cents;
}

export function mulCents(unitCents: Cents | number, quantity: number): Cents {
  if (!Number.isFinite(quantity)) {
    throw new Error("Invalid quantity.");
  }
  // Round half-away-from-zero on the fractional cent after multiply
  const raw = Math.trunc(unitCents) * quantity;
  return Math.round(raw) as Cents;
}

export function vatCents(exclCents: Cents | number, vatPercentage: number): {
  excl: Cents;
  vat: Cents;
  incl: Cents;
} {
  const excl = Math.trunc(exclCents) as Cents;
  const vat = Math.round((excl * vatPercentage) / 100) as Cents;
  return { excl, vat, incl: addCents(excl, vat) };
}

export function parseEurosToCents(value: unknown): Cents | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return toCents(value);
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
  return toCents(parsed);
}
