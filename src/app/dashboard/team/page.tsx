import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatDateTime } from "@/lib/format";
import { inviteEmployeeAction } from "@/app/dashboard/team/actions";
import type { ProfileRow } from "@/types/database";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function TeamPage({ searchParams }: PageProps) {
  const { isDemoMode } = await import("@/lib/demo/mode");
  if (isDemoMode()) {
    const { readDemoStore, seedDemoStoreIfEmpty } = await import("@/lib/demo/store");
    await seedDemoStoreIfEmpty(false);
    const store = await readDemoStore();
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-zinc-50">Team</h1>
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-zinc-900">
            {store.profiles.map((profile) => (
              <div key={profile.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium text-zinc-100">{profile.full_name}</div>
                  <div className="text-zinc-500">{profile.role}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const { session, tenantId } = await requireDashboardSession();

  if (session.profile.role === "super_admin") {
    redirect("/dashboard");
  }

  if (tenantId === null) {
    redirect("/onboarding/need-tenant");
  }

  if (session.profile.role !== "employer") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-zinc-50">Team</h1>
        <Card>
          <p className="text-sm text-zinc-400">
            Only employers can invite team members. Ask your organization owner for access.
          </p>
          <Link className="mt-4 inline-block text-sm text-accent hover:text-emerald-300" href="/dashboard">
            Back to dashboard
          </Link>
        </Card>
      </div>
    );
  }

  const supabase = createSupabaseServerClient();
  const { data: members } = await supabase
    .from("profiles")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .returns<ProfileRow[]>();

  const invited = searchParams["invited"] === "1";
  const errorParam = searchParams["error"];
  const error = typeof errorParam === "string" ? errorParam : undefined;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Team</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Invite field staff by email. They will join with the employee role and your tenant id in their
          profile (via signup metadata).
        </p>
      </div>

      {invited ? (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          Invitation sent. The user will appear here after they accept the invite and sign in.
        </div>
      ) : null}

      {error === "invite" ? (
        <div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          Could not send invite. The email may already be registered — try resetting access from Supabase
          Auth instead.
        </div>
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold text-zinc-100">Invite employee</h2>
        <form action={inviteEmployeeAction} className="mt-4 space-y-4">
          <Input name="full_name" label="Full name" required autoComplete="name" />
          <Input name="email" type="email" label="Email" required autoComplete="email" />
          <Button type="submit">Send invite</Button>
        </form>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-semibold text-zinc-100">Members</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/40 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {(members ?? []).map((member) => (
                <tr key={member.id} className="text-zinc-300">
                  <td className="px-4 py-3 font-medium text-zinc-100">{member.full_name}</td>
                  <td className="px-4 py-3 capitalize text-zinc-400">{member.role.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-zinc-400">{member.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-500">{formatDateTime(member.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(members ?? []).length === 0 ? (
          <div className="px-4 py-8 text-sm text-zinc-500">No team members yet.</div>
        ) : null}
      </Card>
    </div>
  );
}
