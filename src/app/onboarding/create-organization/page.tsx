import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/require-user";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isNonEmptyString } from "@/lib/validation";
import { randomUUID } from "crypto";

/**
 * Organization creation elevates a null-tenant user to employer.
 * Prefer atomic RPC; fall back to compensated admin path if RPC unavailable.
 */
export default async function CreateOrganizationPage() {
  const session = await requireSession();
  if (session.profile === null) {
    redirect("/onboarding/bootstrap-profile");
  }

  if (session.profile.tenant_id !== null) {
    redirect("/dashboard");
  }

  if (session.profile.role === "super_admin") {
    redirect("/dashboard");
  }

  async function createOrganization(formData: FormData) {
    "use server";

    const { requireSession: loadSession } = await import("@/lib/auth/require-user");
    const innerSession = await loadSession();
    if (innerSession.profile === null) {
      redirect("/onboarding/bootstrap-profile");
    }
    if (innerSession.profile.tenant_id !== null) {
      redirect("/dashboard");
    }
    if (innerSession.profile.role === "super_admin") {
      redirect("/dashboard");
    }

    const organizationName = formData.get("organization_name");
    if (!isNonEmptyString(organizationName)) {
      redirect("/onboarding/create-organization?error=name");
    }

    const idempotencyKey = randomUUID();
    const supabase = createSupabaseServerClient();
    // RPC added in migration 20251116231000; not yet in generated Database types.
    const { data: rpcTenantId, error: rpcError } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc("create_organization_for_caller", {
      p_organization_name: organizationName.trim(),
      p_idempotency_key: idempotencyKey,
    });

    if (rpcError === null && typeof rpcTenantId === "string" && rpcTenantId.length > 0) {
      redirect("/dashboard");
    }

    // Fallback for environments where the V2 migration is not applied yet.
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
      .eq("id", innerSession.userId)
      .is("tenant_id", null);

    if (profileError !== null) {
      await admin.from("tenants").delete().eq("id", tenant.id);
      redirect("/onboarding/create-organization?error=profile");
    }

    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <h1 className="font-display text-2xl font-semibold text-ink">Organisatie aanmaken</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Dit maakt je bedrijfstenant aan en wijst je veilig de werkgeverrol toe. Dit is geen
          metadata van de registratiepagina.
        </p>

        <form action={createOrganization} className="mt-6 space-y-4">
          <Input name="organization_name" label="Organisatienaam" required />
          <Button type="submit" className="w-full">
            Organisatie aanmaken
          </Button>
        </form>

        <div className="mt-6 text-sm text-ink-muted">
          Uitloggen?{" "}
          <Link className="text-accent hover:underline" href="/login">
            Terug naar inloggen
          </Link>
        </div>
      </Card>
    </div>
  );
}
