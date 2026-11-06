"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { generateInvoiceFromHoursFormAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type ProjectOption = {
  id: string;
  title: string;
  client_name: string | null;
};

export function GenerateInvoiceModal({ projects }: { projects: readonly ProjectOption[] }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(projects[0]?.id ?? "");

  const selected = projects.find((project) => project.id === selectedId) ?? null;

  if (projects.length === 0) {
    return (
      <Button type="button" variant="secondary" disabled>
        Geen projecten beschikbaar
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
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="generate-invoice-title"
            className="w-full max-w-lg rounded-lg border border-zinc-700 bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <div>
                <h2 id="generate-invoice-title" className="text-lg font-semibold text-zinc-50">
                  Factuur uit goedgekeurde uren
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Sommeert alle approved time entries voor het gekozen project.
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

            <form action={generateInvoiceFromHoursFormAction} className="space-y-4 px-5 py-5">
              <Select
                name="project_id"
                label="Project"
                required
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.title,
                }))}
              />
              <Input
                name="client_name"
                label="Klantnaam"
                required
                defaultValue={selected?.client_name ?? ""}
                key={`name-${selectedId}`}
              />
              <Input name="client_email" type="email" label="Klant e-mail" required />
              <Input
                name="hourly_rate"
                type="number"
                min={0.01}
                step="0.01"
                label="Uurtarief excl. BTW (EUR)"
                required
                defaultValue="65"
              />

              <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 pt-4">
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
