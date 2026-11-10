import { describe, expect, it } from "vitest";
import {
  canTransitionPeriodStatus,
  evaluatePeriodCompleteness,
} from "@/modules/accountant/services/completeness";

describe("accountant completeness", () => {
  it("blocks complete when critical findings exist", () => {
    const result = evaluatePeriodCompleteness({
      salesInvoiceCount: 3,
      purchaseInvoiceCount: 1,
      unmatchedBankTxnCount: 0,
      missingReceiptCount: 2,
      duplicateInvoiceSuspectCount: 0,
      unknownVatCodeCount: 0,
      incompleteSupplierCount: 0,
      openArCount: 1,
      openApCount: 0,
    });
    expect(result.canMarkComplete).toBe(false);
    expect(result.findings.some((f) => f.code === "MISSING_RECEIPTS")).toBe(true);
  });

  it("allows complete with only info/warning findings", () => {
    const result = evaluatePeriodCompleteness({
      salesInvoiceCount: 2,
      purchaseInvoiceCount: 0,
      unmatchedBankTxnCount: 1,
      missingReceiptCount: 0,
      duplicateInvoiceSuspectCount: 0,
      unknownVatCodeCount: 0,
      incompleteSupplierCount: 1,
      openArCount: 2,
      openApCount: 0,
    });
    expect(result.canMarkComplete).toBe(true);
    expect(result.findings.some((f) => f.severity === "critical")).toBe(false);
  });

  it("enforces period status transitions", () => {
    expect(canTransitionPeriodStatus("in_progress", "ready_for_review")).toBe(true);
    expect(canTransitionPeriodStatus("handed_over", "in_progress")).toBe(false);
    expect(canTransitionPeriodStatus("processed_by_accountant", "handed_over")).toBe(false);
  });
});
