"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { createQuoteFormAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { computeVatTotals, formatEuro, lineTotal, roundMoney } from "@/lib/money";

type LineDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

function newLine(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: "",
    quantity: "1",
    unitPrice: "0",
  };
}

export function QuoteBuilderModal() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [vatPercentage, setVatPercentage] = useState("21");

  const totals = useMemo(() => {
    const excl = lines.reduce((sum, line) => {
      const qty = Number.parseFloat(line.quantity.replace(",", ".")) || 0;
      const price = Number.parseFloat(line.unitPrice.replace(",", ".")) || 0;
      return sum + lineTotal(qty, price);
    }, 0);
    const vat = Number.parseInt(vatPercentage, 10);
    return computeVatTotals({
      exclVat: roundMoney(excl),
      vatPercentage: Number.isFinite(vat) ? vat : 21,
    });
  }, [lines, vatPercentage]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(key: string) {
    setLines((current) => (current.length <= 1 ? current : current.filter((line) => line.key !== key)));
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Nieuwe offerte
      </Button>
    );
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Nieuwe offerte
      </Button>

      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quote-builder-title"
          className="w-full max-w-3xl rounded-lg border border-zinc-700 bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <div>
              <h2 id="quote-builder-title" className="text-lg font-semibold text-zinc-50">
                Offerte samenstellen
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Regels, 21% BTW en totalen worden live berekend.
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() => setOpen(false)}
              aria-label="Sluiten"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form action={createQuoteFormAction} className="space-y-5 px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input name="client_name" label="Klantnaam" required />
              <Input name="client_email" type="email" label="Klant e-mail" required />
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
              <Input
                name="vat_percentage"
                type="number"
                min={0}
                max={100}
                label="BTW %"
                value={vatPercentage}
                onChange={(event) => setVatPercentage(event.target.value)}
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
                    onChange={(event) => updateLine(line.key, { description: event.target.value })}
                  />
                  <Input
                    name="item_quantity"
                    label="Aantal"
                    inputMode="decimal"
                    required
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  />
                  <Input
                    name="item_unit_price"
                    label="Prijs excl."
                    inputMode="decimal"
                    required
                    value={line.unitPrice}
                    onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                  />
                  <div className="flex items-end justify-end pb-1">
                    <button
                      type="button"
                      className="rounded-md p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
                      onClick={() => removeLine(line.key)}
                      aria-label="Regel verwijderen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm">
              <div className="flex justify-between text-zinc-400">
                <span>Subtotaal excl. BTW</span>
                <span>{formatEuro(totals.exclVat)}</span>
              </div>
              <div className="mt-1 flex justify-between text-zinc-400">
                <span>BTW</span>
                <span>{formatEuro(totals.vatAmount)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2 text-base font-semibold text-zinc-50">
                <span>Totaal incl. BTW</span>
                <span className="text-accent">{formatEuro(totals.inclVat)}</span>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuleren
              </Button>
              <Button type="submit">Offerte opslaan</Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
