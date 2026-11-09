"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { generateInvoiceFormAction } from "@/app/actions/crm_billing";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ProjectRow } from "@/types/database";

export function GenerateInvoiceModal({ projects }: { projects: readonly ProjectRow[] }) {
  const [open, setOpen] = useState(false);

  if (projects.length === 0) {
    return (
      <Button type="button" variant="secondary" disabled>
        Geen projecten
      </Button>
    );
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Genereer factuur uit uren
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10">
          <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-zinc-50">Factuur uit goedgekeurde uren</h2>
              <button
                type="button"
                className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800"
                onClick={() => setOpen(false)}
                aria-label="Sluiten"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form action={generateInvoiceFormAction} className="space-y-4 px-5 py-5">
              <Select
                name="project_id"
                label="Project"
                required
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.title,
                }))}
              />
              <Input
                name="hourly_rate"
                type="number"
                min={0.01}
                step="0.01"
                label="Uurtarief excl. BTW"
                required
                defaultValue="72"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Annuleren
                </Button>
                <Button type="submit">Conceptfactuur maken</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
