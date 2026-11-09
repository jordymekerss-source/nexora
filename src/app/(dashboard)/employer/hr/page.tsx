import { createCertificateFormAction, getHrBundle } from "@/app/actions/ops";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatDate } from "@/lib/format";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

function daysUntil(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00.000Z`).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export default async function EmployerHrPage({ searchParams }: PageProps) {
  const { certificates, employees } = await getHrBundle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">HR & certificaten</h1>
        <p className="mt-1 text-sm text-zinc-400">
          VCA, rijbewijzen en andere veiligheidsbewijzen met vervalwaarschuwingen.
        </p>
      </div>

      {searchParams["created"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Certificaat toegevoegd.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-zinc-900">
            {certificates.map((certificate) => {
              const days = daysUntil(certificate.expiry_date);
              const tone =
                days < 0
                  ? "border-red-900 bg-red-950/30 text-red-200"
                  : days <= 45
                    ? "border-amber-900 bg-amber-950/20 text-amber-200"
                    : "border-zinc-800 text-zinc-400";
              return (
                <div key={certificate.id} className="flex items-start justify-between gap-3 px-4 py-4">
                  <div>
                    <div className="font-medium text-zinc-100">{certificate.certificate_name}</div>
                    <div className="text-sm text-zinc-500">{certificate.user_name}</div>
                    {certificate.document_url !== null ? (
                      <a
                        href={certificate.document_url}
                        className="mt-1 inline-block text-xs text-accent hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Document openen
                      </a>
                    ) : null}
                  </div>
                  <div className={`rounded-md border px-2 py-1 text-xs ${tone}`}>
                    {formatDate(certificate.expiry_date)}
                    {days < 0 ? " · verlopen" : days <= 45 ? ` · ${days}d` : ""}
                  </div>
                </div>
              );
            })}
          </div>
          {certificates.length === 0 ? (
            <div className="px-4 py-8 text-sm text-zinc-500">Nog geen certificaten.</div>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-zinc-100">Certificaat toevoegen</h2>
          <form action={createCertificateFormAction} className="mt-4 space-y-3">
            <Select
              name="user_id"
              label="Medewerker"
              required
              options={employees.map((employee) => ({
                value: employee.id,
                label: employee.full_name,
              }))}
            />
            <Input
              name="certificate_name"
              label="Certificaat"
              required
              placeholder="VCA Basis"
            />
            <Input name="expiry_date" label="Vervaldatum" type="date" required />
            <Input
              name="document_url"
              label="Document URL (optioneel)"
              placeholder="https://..."
            />
            <Button type="submit" className="w-full">
              Toevoegen
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
