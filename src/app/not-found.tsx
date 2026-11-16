import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">NEXORA</div>
      <h1 className="mt-3 text-2xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        The page you requested does not exist or you do not have access to it.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink hover:bg-emerald-400"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
