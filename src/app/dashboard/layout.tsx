import type { ReactNode } from "react";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { AppShell, SignOutForm } from "@/components/app/AppShell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { session } = await requireDashboardSession();

  const userLabel =
    session.email !== null && session.email.length > 0 ? session.email : session.userId;

  return (
    <AppShell role={session.profile.role} userLabel={userLabel} signOutSlot={<SignOutForm />}>
      {children}
    </AppShell>
  );
}
