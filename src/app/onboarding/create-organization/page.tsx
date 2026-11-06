import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/require-user";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isNonEmptyString } from "@/lib/validation";

export default async function CreateOrganizationPage() {
  const session = await requireSession();
  if (session.profile === null) {
    redirect("/onboarding/bootstrap-profile");
  }

  if (session.profile.role !== "employer") {
    redirect("/dashboard");
  }

  if (session.profile.tenant_id !== null) {
    redirect("/dashboard");
  }

  async function createOrganization(formData: FormData) {
    "use server";

    const { requireSession: loadSession } = await import("@/lib/auth/require-user");
    const innerSession = await loadSession();
    if (innerSession.profile === null || innerSession.profile.role !== "employer") {
      redirect("/dashboard");
    }
    if (innerSession.profile.tenant_id !== null) {
      redirect("/dashboard");
    }

    const organizationName = formData.get("organization_name");
    if (!isNonEmptyString(organizationName)) {
      redirect("/onboarding/create-organization?error=name");
    }

    const admin = getSupabaseAdminClient();

    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .insert({ name: organizationName.trim() })
      .select("id")
      .single();

    if (tenantError !== null || tenant === null) {
      redirect("/onboarding/create-organization?error=tenant");
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({ tenant_id: tenant.id, role: "employer" })
      .eq("id", innerSession.userId);

    if (profileError !== null) {
      await admin.from("tenants").delete().eq("id", tenant.id);
      redirect("/onboarding/create-organization?error=profile");
    }

    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <h1 className="text-xl font-semibold text-zinc-50">Create your organization</h1>
        <p className="mt-2 text-sm text-zinc-400">
          This creates your tenant in NEXORA and attaches your employer account to it.
        </p>

        <form action={createOrganization} className="mt-6 space-y-4">
          <Input name="organization_name" label="Organization name" required />
          <Button type="submit" className="w-full">
            Create organization
          </Button>
        </form>

        <div className="mt-6 text-sm text-zinc-500">
          Need to sign out?{" "}
          <Link className="text-accent hover:text-emerald-300" href="/login">
            Back to sign in
          </Link>
        </div>
      </Card>
    </div>
  );
}
