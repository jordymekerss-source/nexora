import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAuthenticatedSession } from "@/lib/auth/require-user";
import { resolveDemoLogin } from "@/lib/demo/credentials";
import { isDemoMode } from "@/lib/demo/mode";
import { DEMO_PERSONA_COOKIE } from "@/lib/demo/persona";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const errorParam = searchParams["error"];
  const error = typeof errorParam === "string" ? errorParam : undefined;

  if (isDemoMode()) {
    async function demoSignIn(formData: FormData) {
      "use server";

      const email = formData.get("email");
      const password = formData.get("password");
      if (typeof email !== "string" || typeof password !== "string") {
        redirect("/login?error=form");
      }

      const account = resolveDemoLogin(email, password);
      if (account === null) {
        redirect("/login?error=credentials");
      }

      const { seedDemoStoreIfEmpty } = await import("@/lib/demo/store");
      await seedDemoStoreIfEmpty(false);

      cookies().set(DEMO_PERSONA_COOKIE, account.persona, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
      });
      redirect(account.redirectTo);
    }

    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              NEXORA
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Inloggen</h1>
            <p className="mt-2 text-sm text-zinc-400">
              Demo-omgeving — gebruik de testaccounts hieronder.
            </p>
          </div>

          <Card>
            <form action={demoSignIn} className="space-y-4">
              <Input
                name="email"
                type="email"
                autoComplete="email"
                required
                label="Zakelijk e-mailadres"
                placeholder="sam@nexora.local"
                data-testid="login-email"
              />
              <Input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                label="Wachtwoord"
                data-testid="login-password"
              />

              {error === "credentials" || error === "form" ? (
                <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                  Ongeldige e-mail of wachtwoord.
                </div>
              ) : null}

              <Button type="submit" className="w-full" data-testid="login-submit">
                Inloggen
              </Button>
            </form>
          </Card>

          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-400">
            <div>
              Medewerker: <code>sam@nexora.local</code> / <code>nexora-demo-employee</code>
            </div>
            <div className="mt-1">
              Werkgever: <code>demo@nexora.local</code> / <code>nexora-demo-employer</code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const session = await getAuthenticatedSession();
  if (session !== null) {
    redirect("/dashboard");
  }

  async function signIn(formData: FormData) {
    "use server";

    const email = formData.get("email");
    const password = formData.get("password");

    if (typeof email !== "string" || typeof password !== "string") {
      redirect("/login?error=form");
    }

    const supabase = createSupabaseServerClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError !== null) {
      redirect("/login?error=credentials");
    }

    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            NEXORA
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Inloggen</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Multi-tenant bedrijfsplatform voor installatie- en dienstverlenende bedrijven.
          </p>
        </div>

        <Card>
          <form action={signIn} className="space-y-4">
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              label="Zakelijk e-mailadres"
              placeholder="jij@bedrijf.nl"
              data-testid="login-email"
            />
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              label="Wachtwoord"
              data-testid="login-password"
            />

            {error === "credentials" ? (
              <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                Ongeldige e-mail of wachtwoord.
              </div>
            ) : null}
            {error === "oauth" || error === "session" ? (
              <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                Authenticatie mislukt. Probeer opnieuw.
              </div>
            ) : null}

            <Button type="submit" className="w-full" data-testid="login-submit">
              Inloggen
            </Button>
          </form>
        </Card>

        <div className="text-center text-sm text-zinc-400">
          Nog geen account?{" "}
          <Link className="font-medium text-accent hover:text-emerald-300" href="/signup">
            Account aanmaken
          </Link>
        </div>
      </div>
    </div>
  );
}
