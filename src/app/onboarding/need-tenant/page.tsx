import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/require-user";
import { Card } from "@/components/ui/Card";

export default async function NeedTenantPage() {
  const session = await requireSession();
  if (session.profile === null) {
    redirect("/onboarding/bootstrap-profile");
  }

  if (session.profile.tenant_id !== null) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <h1 className="text-xl font-semibold text-zinc-50">Waiting for an organization</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Your account is active, but you are not assigned to a tenant yet. Ask your employer to
          invite you from the Team page, or sign in with the invited email link.
        </p>
        <div className="mt-6">
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500"
            >
              Sign out
            </button>
          </form>
        </div>
        <div className="mt-4 text-sm text-zinc-500">
          Wrong account?{" "}
          <Link className="text-accent hover:text-emerald-300" href="/login">
            Sign in with a different email
          </Link>
        </div>
      </Card>
    </div>
  );
}
