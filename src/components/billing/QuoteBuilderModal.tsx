"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { createQuoteFormAction } from "@/app/actions/crm_billing";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { computeVatTotals, formatEuro, lineTotal, roundMoney } from "@/lib/money";
import type { ClientRow } from "@/types/database";

type LineDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

function newLine(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: "",
    quantity: "1",
    unitPrice: "0",
  };
}

export function QuoteBuilderModal({ clients }: { clients: readonly ClientRow[] }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);

  const totals = useMemo(() => {
    const excl = lines.reduce((sum, line) => {
      const qty = Number.parseFloat(line.quantity.replace(",", ".")) || 0;
      const price = Number.parseFloat(line.unitPrice.replace(",", ".")) || 0;
      return sum + lineTotal(qty, price);
    }, 0);
    return computeVatTotals({ exclVat: roundMoney(excl), vatPercentage: 21 });
  }, [lines]);

  if (clients.length === 0) {
    return (
      <Button type="button" variant="secondary" disabled>
        Voeg eerst een klant toe
      </Button>
    );
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Nieuwe offerte
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10">
          <div className="w-full max-w-3xl rounded-lg border border-zinc-700 bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-50">Offerte samenstellen</h2>
                <p className="mt-1 text-sm text-zinc-400">BTW 21% wordt direct herberekend.</p>
              </div>
              <button
                type="button"
                className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800"
                onClick={() => setOpen(false)}
                aria-label="Sluiten"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form action={createQuoteFormAction} className="space-y-5 px-5 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  name="client_id"
                  label="Klant"
                  required
                  options={clients.map((client) => ({
                    value: client.id,
                    label: client.company_name,
                  }))}
                />
                <Input name="valid_until" type="date" label="Geldig tot" />
                <Select
                  name="status"
                  label="Status"
                  defaultValue="draft"
                  options={[
                    { value: "draft", label: "Concept" },
                    { value: "sent", label: "Verzonden" },
                  ]}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-200">Regels</h3>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setLines((current) => [...current, newLine()])}
                  >
                    <Plus className="h-4 w-4" />
                    Regel
                  </Button>
                </div>
                {lines.map((line) => (
                  <div
                    key={line.key}
                    className="grid gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-[1fr_110px_130px_40px]"
                  >
                    <Input
                      name="item_description"
                      label="Omschrijving"
                      required
                      value={line.description}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((row) =>
                            row.key === line.key
                              ? { ...row, description: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                    <Input
                      name="item_quantity"
                      label="Aantal"
                      required
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((row) =>
                            row.key === line.key ? { ...row, quantity: event.target.value } : row,
                          ),
                        )
                      }
                    />
                    <Input
                      name="item_unit_price"
                      label="Prijs excl."
                      required
                      value={line.unitPrice}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((row) =>
                            row.key === line.key ? { ...row, unitPrice: event.target.value } : row,
                          ),
                        )
                      }
                    />
                    <div className="flex items-end justify-end pb-1">
                      <button
                        type="button"
                        className="rounded-md p-2 text-zinc-500 hover:text-red-300"
                        onClick={() =>
                          setLines((current) =>
                            current.length <= 1
                              ? current
                              : current.filter((row) => row.key !== line.key),
                          )
                        }
                        aria-label="Verwijderen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm">
                <div className="flex justify-between text-zinc-400">
                  <span>Subtotaal</span>
                  <span>{formatEuro(totals.exclVat)}</span>
                </div>
                <div className="mt-1 flex justify-between text-zinc-400">
                  <span>BTW 21%</span>
                  <span>{formatEuro(totals.vatAmount)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2 font-semibold text-zinc-50">
                  <span>Totaal</span>
                  <span className="text-accent">{formatEuro(totals.inclVat)}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Annuleren
                </Button>
                <Button type="submit">Offerte opslaan</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
