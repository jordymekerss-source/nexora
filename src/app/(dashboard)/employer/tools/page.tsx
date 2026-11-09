import {
  checkoutToolFormAction,
  createToolFormAction,
  getToolsBundle,
  updateToolStatusFormAction,
} from "@/app/actions/ops";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Actief",
  maintenance: "Onderhoud",
  broken: "Kapot",
};

export default async function EmployerToolsPage({ searchParams }: PageProps) {
  const { tools, employees } = await getToolsBundle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Gereedschap & materieel</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Registratie van apparatuur en wie wat op de bus heeft.
        </p>
      </div>

      {searchParams["created"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Gereedschap geregistreerd.
        </div>
      ) : null}
      {searchParams["updated"] === "1" ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Status bijgewerkt.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-zinc-900">
            {tools.map((tool) => (
              <div key={tool.id} className="space-y-3 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-zinc-100">{tool.name}</div>
                    <div className="text-sm text-zinc-500">
                      {tool.serial_number ?? "geen serienr"} ·{" "}
                      {STATUS_LABEL[tool.status] ?? tool.status}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400">
                    {tool.checked_out_to_name ?? "Op voorraad"}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <form action={updateToolStatusFormAction} className="flex gap-2">
                    <input type="hidden" name="id" value={tool.id} />
                    <Select
                      name="status"
                      label="Status"
                      defaultValue={tool.status}
                      options={[
                        { value: "active", label: "Actief" },
                        { value: "maintenance", label: "Onderhoud" },
                        { value: "broken", label: "Kapot" },
                      ]}
                    />
                    <div className="flex items-end">
                      <Button type="submit">Status</Button>
                    </div>
                  </form>
                  <form action={checkoutToolFormAction} className="flex gap-2">
                    <input type="hidden" name="id" value={tool.id} />
                    <Select
                      name="checked_out_to_user_id"
                      label="Uitchecken aan"
                      defaultValue={tool.checked_out_to_user_id ?? ""}
                      options={[
                        { value: "", label: "Op voorraad" },
                        ...employees.map((employee) => ({
                          value: employee.id,
                          label: employee.full_name,
                        })),
                      ]}
                    />
                    <div className="flex items-end">
                      <Button type="submit">Toewijzen</Button>
                    </div>
                  </form>
                </div>
              </div>
            ))}
          </div>
          {tools.length === 0 ? (
            <div className="px-4 py-8 text-sm text-zinc-500">Nog geen gereedschap.</div>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-zinc-100">Gereedschap registreren</h2>
          <form action={createToolFormAction} className="mt-4 space-y-3">
            <Input name="name" label="Naam" required placeholder="Bosch boormachine" />
            <Input name="serial_number" label="Serienummer" required placeholder="SN-001" />
            <Select
              name="status"
              label="Status"
              defaultValue="active"
              options={[
                { value: "active", label: "Actief" },
                { value: "maintenance", label: "Onderhoud" },
                { value: "broken", label: "Kapot" },
              ]}
            />
            <Select
              name="checked_out_to_user_id"
              label="Uitchecken aan"
              options={[
                { value: "", label: "Op voorraad" },
                ...employees.map((employee) => ({
                  value: employee.id,
                  label: employee.full_name,
                })),
              ]}
            />
            <Button type="submit" className="w-full">
              Registreren
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
