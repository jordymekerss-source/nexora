"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { createClientFormAction } from "@/app/actions/crm_billing";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

export function ClientFormModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Nieuwe klant
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10">
          <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-zinc-50">Nieuwe klant</h2>
              <button
                type="button"
                className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800"
                onClick={() => setOpen(false)}
                aria-label="Sluiten"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form action={createClientFormAction} className="space-y-4 px-5 py-5">
              <Input name="company_name" label="Bedrijfsnaam" required />
              <Input name="contact_person" label="Contactpersoon" />
              <Input name="email" type="email" label="E-mail" required />
              <Input name="phone" label="Telefoon" />
              <Input name="address" label="Adres" required />
              <Textarea name="notes" label="Notities" rows={3} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Annuleren
                </Button>
                <Button type="submit">Opslaan</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
