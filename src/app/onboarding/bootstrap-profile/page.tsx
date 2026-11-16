import Link from "next/link";
import { requireSession } from "@/lib/auth/require-user";
import { Card } from "@/components/ui/Card";

export default async function BootstrapProfilePage() {
  const session = await requireSession();

  if (session.profile !== null) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Card>
          <h1 className="text-xl font-semibold text-ink">Profile ready</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Your profile already exists. Continue to the dashboard.
          </p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-accent hover:text-emerald-300" href="/dashboard">
              Go to dashboard
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <h1 className="text-xl font-semibold text-ink">Finish account setup</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Your signed-in account does not have a profile row yet. This usually means the database
          trigger <span className="font-mono text-xs text-ink-muted">handle_new_user</span> is not
          installed. Ask an administrator to apply the Supabase migration, then sign out and sign
          back in.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="rounded-md border border-surface-border bg-transparent px-3 py-2 text-sm text-ink hover:border-zinc-500"
            >
              Sign out
            </button>
          </form>
          <Link
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-ink hover:bg-emerald-400"
            href="/dashboard"
          >
            Try dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}
