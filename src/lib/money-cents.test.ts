import { describe, expect, it } from "vitest";
import { addCents, mulCents, parseEurosToCents, toCents, vatCents } from "@/lib/money-cents";

describe("money-cents", () => {
  it("converts euros to integer cents without float drift on common values", () => {
    expect(toCents(10.1)).toBe(1010);
    expect(toCents(19.99)).toBe(1999);
  });

  it("computes VAT in cents", () => {
    const result = vatCents(toCents(100), 21);
    expect(result.excl).toBe(10000);
    expect(result.vat).toBe(2100);
    expect(result.incl).toBe(12100);
  });

  it("multiplies line items in cents", () => {
    expect(mulCents(toCents(12.5), 3)).toBe(3750);
  });

  it("adds cents exactly", () => {
    expect(addCents(101, 20)).toBe(121);
  });

  it("parses Dutch-style decimal strings", () => {
    expect(parseEurosToCents("12,50")).toBe(1250);
  });
});
