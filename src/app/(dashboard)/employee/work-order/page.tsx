import Link from "next/link";
import { redirect } from "next/navigation";
import { getEmployeeMobileBundle } from "@/app/actions/ops";
import { SignaturePad } from "@/components/workorders/SignaturePad";
import { Card } from "@/components/ui/Card";
import { requireEmployeeSession } from "@/lib/auth/require-user";
import { isUuid } from "@/lib/validation";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function EmployeeWorkOrderPage({ searchParams }: PageProps) {
  await requireEmployeeSession();
  const projectId = typeof searchParams["projectId"] === "string" ? searchParams["projectId"] : "";
  if (!isUuid(projectId)) {
    redirect("/employee");
  }

  const { assignedProjects } = await getEmployeeMobileBundle();
  const project = assignedProjects.find((row) => row.id === projectId) ?? null;
  if (project === null) {
    redirect("/employee?error=project");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link href="/employee" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Terug
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-zinc-50">Digitale werkbon</h1>
        <p className="mt-1 text-sm text-zinc-400">{project.title}</p>
      </div>

      {searchParams["error"] === "sign" ? (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          Handtekening of samenvatting ontbreekt.
        </div>
      ) : null}

      <Card>
        <SignaturePad projectId={project.id} projectTitle={project.title} />
      </Card>
    </div>
  );
}
