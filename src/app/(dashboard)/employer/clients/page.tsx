import {
  getClients,
  seedDemoDataFormAction,
} from "@/app/actions/crm_billing";
import { ClientFormModal } from "@/components/billing/ClientFormModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function EmployerClientsPage({ searchParams }: PageProps) {
  const q = typeof searchParams["q"] === "string" ? searchParams["q"].toLowerCase() : "";
  const clients = await getClients();
  const filtered =
    q.length === 0
      ? clients
      : clients.filter(
          (client) =>
            client.company_name.toLowerCase().includes(q) ||
            client.email.toLowerCase().includes(q) ||
            (client.contact_person ?? "").toLowerCase().includes(q),
        );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">Klanten</h1>
          <p className="mt-1 text-sm text-zinc-400">
            CRM-overzicht voor offertes, facturen en projectcommunicatie.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={seedDemoDataFormAction}>
            <input type="hidden" name="force" value="0" />
            <Button type="submit" variant="secondary">
              Seed demo data
            </Button>
          </form>
          <ClientFormModal />
        </div>
      </div>

      {searchParams["seeded"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Demo data geladen.
        </div>
      ) : null}
      {searchParams["created"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Klant aangemaakt.
        </div>
      ) : null}

      <Card>
        <form className="mb-4">
          <input
            name="q"
            defaultValue={q}
            placeholder="Zoek op bedrijf, contact of e-mail…"
            className="w-full rounded-md border border-zinc-700 bg-surface-elevated px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
          />
        </form>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-2 py-3">Bedrijf</th>
                <th className="px-2 py-3">Contact</th>
                <th className="px-2 py-3">E-mail</th>
                <th className="px-2 py-3">Telefoon</th>
                <th className="px-2 py-3">Adres</th>
                <th className="px-2 py-3">Sinds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {filtered.map((client) => (
                <tr key={client.id} className="text-zinc-300">
                  <td className="px-2 py-3 font-medium text-zinc-100">{client.company_name}</td>
                  <td className="px-2 py-3">{client.contact_person ?? "—"}</td>
                  <td className="px-2 py-3">{client.email}</td>
                  <td className="px-2 py-3">{client.phone ?? "—"}</td>
                  <td className="px-2 py-3">{client.address}</td>
                  <td className="px-2 py-3 text-zinc-500">{formatDateTime(client.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <div className="py-8 text-sm text-zinc-500">Geen klanten gevonden.</div>
        ) : null}
      </Card>
    </div>
  );
}
