import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ProfileRole } from "@/types/database";

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
    const role = formData.get("role");

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof fullName !== "string" ||
      typeof role !== "string"
    ) {
      redirect("/signup?error=form");
    }

    const normalizedRole = role as ProfileRole;
    if (normalizedRole !== "employer" && normalizedRole !== "employee") {
      redirect("/signup?error=role");
    }

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
          role: normalizedRole,
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
          <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Create account</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Employers can create an organization after signup. Employees join via invitation.
          </p>
        </div>

        <Card>
          <form action={signUp} className="space-y-4">
            <Input name="full_name" label="Full name" required autoComplete="name" />
            <Input name="email" type="email" label="Work email" required autoComplete="email" />
            <Input
              name="password"
              type="password"
              label="Password"
              required
              autoComplete="new-password"
              minLength={8}
              hint="At least 8 characters."
            />
            <Select
              name="role"
              label="Role"
              required
              defaultValue="employer"
              options={[
                { value: "employer", label: "Employer (organization owner)" },
                { value: "employee", label: "Employee (join via invite)" },
              ]}
            />

            <Button type="submit" className="w-full">
              Create account
            </Button>
          </form>
        </Card>

        <div className="text-center text-sm text-zinc-400">
          Already have an account?{" "}
          <Link className="font-medium text-accent hover:text-emerald-300" href="/login">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
