import { describe, expect, it } from "vitest";
import { computeVatTotals, lineTotal, roundMoney } from "@/lib/money";

describe("money (cent-backed)", () => {
  it("rounds common euro values stably", () => {
    expect(roundMoney(10.1)).toBe(10.1);
    expect(roundMoney(19.99)).toBe(19.99);
  });

  it("computes 21% VAT without float surprises on 100", () => {
    expect(computeVatTotals({ exclVat: 100, vatPercentage: 21 })).toEqual({
      exclVat: 100,
      vatAmount: 21,
      inclVat: 121,
    });
  });

  it("computes line totals from fractional quantities", () => {
    expect(lineTotal(1.5, 80)).toBe(120);
  });
});
