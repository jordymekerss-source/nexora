export class IntegrationNotConfiguredError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(
      `Integratie '${provider}' is niet geconfigureerd. Geen live API-aanroep uitgevoerd.`,
    );
    this.name = "IntegrationNotConfiguredError";
    this.provider = provider;
  }
}

export type IntegrationCapability =
  | "customers"
  | "suppliers"
  | "invoices"
  | "ledger"
  | "vat_codes"
  | "payments"
  | "documents"
  | "bank_transactions";

export type IntegrationAdapter = {
  readonly provider: string;
  capabilities(): readonly IntegrationCapability[];
  isConfigured(): boolean;
};

export function createStubAdapter(
  provider: string,
  caps: readonly IntegrationCapability[] = [],
): IntegrationAdapter {
  return {
    provider,
    capabilities: () => caps,
    isConfigured: () => false,
  };
}

/** Registry of known bookkeeping adapters — none are live without credentials. */
export const BOOKKEEPING_ADAPTERS: ReadonlyArray<IntegrationAdapter> = [
  createStubAdapter("exact_online", ["customers", "suppliers", "invoices", "vat_codes"]),
  createStubAdapter("yuki", ["invoices", "documents"]),
  createStubAdapter("afas", ["customers", "suppliers", "invoices", "ledger"]),
  createStubAdapter("snelstart", ["invoices", "ledger", "vat_codes"]),
];

export function requireConfiguredAdapter(adapter: IntegrationAdapter): void {
  if (!adapter.isConfigured()) {
    throw new IntegrationNotConfiguredError(adapter.provider);
  }
}
