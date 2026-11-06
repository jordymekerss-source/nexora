import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const session = await getAuthenticatedSession();
  if (session !== null) {
    redirect("/dashboard");
  }

  const errorParam = searchParams["error"];
  const error = typeof errorParam === "string" ? errorParam : undefined;

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
          <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Sign in</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Multi-tenant ERP for field services and construction teams.
          </p>
        </div>

        <Card>
          <form action={signIn} className="space-y-4">
            <Input
              name="email"
              type="email"
              autoComplete="email"
              required
              label="Work email"
              placeholder="you@company.com"
            />
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              label="Password"
            />

            {error === "credentials" ? (
              <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                Invalid email or password.
              </div>
            ) : null}
            {error === "oauth" || error === "session" ? (
              <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                Authentication failed. Try again.
              </div>
            ) : null}

            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </Card>

        <div className="text-center text-sm text-zinc-400">
          No account?{" "}
          <Link className="font-medium text-accent hover:text-emerald-300" href="/signup">
            Create one
          </Link>
        </div>
      </div>
    </div>
  );
}
