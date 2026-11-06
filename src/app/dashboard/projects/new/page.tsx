import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { isNonEmptyString } from "@/lib/validation";
import type { ProjectStatus } from "@/types/database";

export default async function NewProjectPage() {
  const { session, tenantId } = await requireDashboardSession();

  if (session.profile.role !== "employer" || tenantId === null) {
    redirect("/dashboard/projects");
  }

  async function createProject(formData: FormData) {
    "use server";

    const { requireDashboardSession: load } = await import("@/lib/auth/require-user");
    const ctx = await load();
    if (ctx.session.profile.role !== "employer" || ctx.tenantId === null) {
      redirect("/dashboard/projects");
    }

    const title = formData.get("title");
    const clientName = formData.get("client_name");
    const address = formData.get("address");
    const status = formData.get("status");

    if (!isNonEmptyString(title) || !isNonEmptyString(address) || typeof status !== "string") {
      redirect("/dashboard/projects/new?error=form");
    }

    const normalizedStatus = status as ProjectStatus;
    if (!["planning", "active", "completed"].includes(normalizedStatus)) {
      redirect("/dashboard/projects/new?error=status");
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        tenant_id: ctx.tenantId,
        title: title.trim(),
        client_name: typeof clientName === "string" && clientName.trim().length > 0 ? clientName.trim() : null,
        address: address.trim(),
        status: normalizedStatus,
      })
      .select("id")
      .single();

    if (error !== null || data === null) {
      redirect("/dashboard/projects/new?error=db");
    }

    redirect(`/dashboard/projects/${data.id}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard/projects"
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          ← Back to projects
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-50">New project</h1>
        <p className="mt-2 text-sm text-zinc-400">Create a job site your team can clock into.</p>
      </div>

      <Card>
        <form action={createProject} className="space-y-4">
          <Input name="title" label="Title" required />
          <Input name="client_name" label="Client name" />
          <Input name="address" label="Site address" required />
          <Select
            name="status"
            label="Status"
            defaultValue="active"
            options={[
              { value: "planning", label: "Planning" },
              { value: "active", label: "Active" },
              { value: "completed", label: "Completed" },
            ]}
          />

          <Button type="submit" className="w-full sm:w-auto">
            Create project
          </Button>
        </form>
      </Card>
    </div>
  );
}
