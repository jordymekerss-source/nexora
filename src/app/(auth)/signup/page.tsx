import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export default async function SignupPage() {
  const session = await getAuthenticatedSession();
  if (session !== null) {
    redirect("/dashboard");
  }

  async function signUp(formData: FormData) {
    "use server";

    const email = formData.get("email");
    const password = formData.get("password");
    const fullName = formData.get("full_name");

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof fullName !== "string"
    ) {
      redirect("/signup?error=form");
    }

    // Do NOT send role/tenant_id in user metadata. Privileges are assigned only by
    // server-side onboarding (create organization) or tenant_invites consumption.
    const supabase = createSupabaseServerClient();
    const { getSiteUrl } = await import("@/lib/supabase/public-env");
    const origin = getSiteUrl();

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
        data: {
          full_name: fullName.trim(),
        },
      },
    });

    if (error !== null || data.user === null) {
      redirect("/signup?error=signup");
    }

    redirect("/login?notice=confirm");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            NEXORA
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Account aanmaken</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Na registratie maak je als werkgever een organisatie aan. Medewerkers worden
            alleen via een bedrijfsuitnodiging toegevoegd.
          </p>
        </div>

        <Card>
          <form action={signUp} className="space-y-4">
            <Input name="full_name" label="Volledige naam" required autoComplete="name" />
            <Input
              name="email"
              type="email"
              label="Zakelijk e-mailadres"
              required
              autoComplete="email"
            />
            <Input
              name="password"
              type="password"
              label="Wachtwoord"
              required
              autoComplete="new-password"
              minLength={8}
              hint="Minimaal 8 tekens."
            />
            <Button type="submit" className="w-full">
              Account aanmaken
            </Button>
          </form>
        </Card>

        <div className="text-center text-sm text-zinc-400">
          Al een account?{" "}
          <Link className="font-medium text-accent hover:text-emerald-300" href="/login">
            Inloggen
          </Link>
        </div>
      </div>
    </div>
  );
}
