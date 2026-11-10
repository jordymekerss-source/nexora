import type {
  ChecklistFinding,
  PeriodCompletenessInput,
  PeriodCompletenessResult,
} from "@/modules/accountant/types";

/**
 * Pure completeness checker for accountant period packs.
 * Never auto-asserts fiscal correctness — only structural readiness.
 */
export function evaluatePeriodCompleteness(
  input: PeriodCompletenessInput,
): PeriodCompletenessResult {
  const findings: ChecklistFinding[] = [];

  if (input.salesInvoiceCount === 0 && input.purchaseInvoiceCount === 0) {
    findings.push({
      code: "NO_INVOICES",
      severity: "warning",
      message: "Geen verkoop- of inkoopfacturen in deze periode.",
    });
  }

  if (input.missingReceiptCount > 0) {
    findings.push({
      code: "MISSING_RECEIPTS",
      severity: "critical",
      message: `${input.missingReceiptCount} bonnetje(s) of bijlage(n) ontbreken.`,
    });
  }

  if (input.duplicateInvoiceSuspectCount > 0) {
    findings.push({
      code: "DUPLICATE_INVOICE_SUSPECT",
      severity: "critical",
      message: `${input.duplicateInvoiceSuspectCount} mogelijke dubbele factuur(en).`,
    });
  }

  if (input.unknownVatCodeCount > 0) {
    findings.push({
      code: "UNKNOWN_VAT",
      severity: "critical",
      message: `${input.unknownVatCodeCount} onbekende of onvolledige BTW-code(s).`,
    });
  }

  if (input.incompleteSupplierCount > 0) {
    findings.push({
      code: "INCOMPLETE_SUPPLIER",
      severity: "warning",
      message: `${input.incompleteSupplierCount} leverancier(s) met onvolledige gegevens.`,
    });
  }

  if (input.unmatchedBankTxnCount > 0) {
    findings.push({
      code: "UNMATCHED_BANK",
      severity: "warning",
      message: `${input.unmatchedBankTxnCount} banktransactie(s) niet gematcht.`,
    });
  }

  if (input.openArCount > 0) {
    findings.push({
      code: "OPEN_AR",
      severity: "info",
      message: `${input.openArCount} openstaande debiteurpost(en).`,
    });
  }

  if (input.openApCount > 0) {
    findings.push({
      code: "OPEN_AP",
      severity: "info",
      message: `${input.openApCount} openstaande crediteurpost(en).`,
    });
  }

  const canMarkComplete = !findings.some((f) => f.severity === "critical");
  return { findings, canMarkComplete };
}

export const ACCOUNTING_PERIOD_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  in_progress: ["awaiting_missing_info", "ready_for_review"],
  awaiting_missing_info: ["in_progress", "ready_for_review"],
  ready_for_review: ["approved_by_owner", "awaiting_missing_info"],
  approved_by_owner: ["handed_over", "ready_for_review"],
  handed_over: ["in_review_by_accountant"],
  in_review_by_accountant: ["returned_for_correction", "processed_by_accountant"],
  returned_for_correction: ["in_progress", "ready_for_review"],
  processed_by_accountant: [],
};

export function canTransitionPeriodStatus(from: string, to: string): boolean {
  const allowed = ACCOUNTING_PERIOD_TRANSITIONS[from];
  if (allowed === undefined) return false;
  return allowed.includes(to);
}
