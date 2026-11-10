export type ChecklistSeverity = "critical" | "warning" | "info";

export type ChecklistFinding = {
  code: string;
  severity: ChecklistSeverity;
  message: string;
  entityType?: string;
  entityId?: string;
};

export type PeriodCompletenessInput = {
  salesInvoiceCount: number;
  purchaseInvoiceCount: number;
  unmatchedBankTxnCount: number;
  missingReceiptCount: number;
  duplicateInvoiceSuspectCount: number;
  unknownVatCodeCount: number;
  incompleteSupplierCount: number;
  openArCount: number;
  openApCount: number;
};

export type PeriodCompletenessResult = {
  findings: ChecklistFinding[];
  canMarkComplete: boolean;
};
