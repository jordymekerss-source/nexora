import { createVehicleFormAction, getFleetBundle, updateVehicleFormAction } from "@/app/actions/ops";
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

export default async function EmployerFleetPage({ searchParams }: PageProps) {
  const { vehicles, employees } = await getFleetBundle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Wagenpark</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Bedrijfsbussen, APK-datums en kilometerstand bijhouden.
        </p>
      </div>

      {searchParams["created"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Voertuig toegevoegd.
        </div>
      ) : null}
      {searchParams["updated"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Voertuig bijgewerkt.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-zinc-900">
            {vehicles.map((vehicle) => {
              const days =
                vehicle.apk_expiry_date !== null ? daysUntil(vehicle.apk_expiry_date) : null;
              const apkTone =
                days === null
                  ? "text-zinc-500"
                  : days < 0
                    ? "text-red-300"
                    : days <= 30
                      ? "text-amber-300"
                      : "text-zinc-400";
              return (
                <div key={vehicle.id} className="space-y-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-zinc-100">{vehicle.license_plate}</div>
                      <div className="text-sm text-zinc-500">{vehicle.brand_model}</div>
                    </div>
                    <div className={`text-xs ${apkTone}`}>
                      {vehicle.apk_expiry_date !== null
                        ? `APK ${formatDate(vehicle.apk_expiry_date)}${
                            days !== null && days < 0
                              ? " (verlopen)"
                              : days !== null && days <= 30
                                ? ` (${days}d)`
                                : ""
                          }`
                        : "APK onbekend"}
                    </div>
                  </div>
                  <div className="text-sm text-zinc-400">
                    {vehicle.km_status.toLocaleString("nl-NL")} km ·{" "}
                    {vehicle.assigned_user_name ?? "Niet toegewezen"}
                  </div>
                  <form action={updateVehicleFormAction} className="grid gap-2 sm:grid-cols-3">
                    <input type="hidden" name="id" value={vehicle.id} />
                    <Input
                      name="km_status"
                      label="Km-stand"
                      type="number"
                      defaultValue={String(vehicle.km_status)}
                      required
                    />
                    <Select
                      name="assigned_user_id"
                      label="Chauffeur"
                      options={[
                        { value: "", label: "Niet toegewezen" },
                        ...employees.map((employee) => ({
                          value: employee.id,
                          label: employee.full_name,
                        })),
                      ]}
                      defaultValue={vehicle.assigned_user_id ?? ""}
                    />
                    <div className="flex items-end">
                      <Button type="submit" className="w-full">
                        Opslaan
                      </Button>
                    </div>
                  </form>
                </div>
              );
            })}
          </div>
          {vehicles.length === 0 ? (
            <div className="px-4 py-8 text-sm text-zinc-500">Nog geen voertuigen.</div>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-zinc-100">Voertuig toevoegen</h2>
          <form action={createVehicleFormAction} className="mt-4 space-y-3">
            <Input name="license_plate" label="Kenteken" required placeholder="V-123-NX" />
            <Input name="brand_model" label="Merk / model" required placeholder="VW Transporter" />
            <Input name="apk_expiry_date" label="APK vervaldatum" type="date" required />
            <Input name="km_status" label="Kilometerstand" type="number" defaultValue="0" required />
            <Select
              name="assigned_user_id"
              label="Toegewezen medewerker"
              options={[
                { value: "", label: "Niet toegewezen" },
                ...employees.map((employee) => ({
                  value: employee.id,
                  label: employee.full_name,
                })),
              ]}
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
