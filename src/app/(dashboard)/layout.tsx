import type { ReactNode } from "react";
import { requireDashboardSession } from "@/lib/auth/require-user";
import { AppShell, SignOutForm } from "@/components/app/AppShell";
import { listEnabledModules } from "@/lib/entitlements/check";
import { DEFAULT_ENABLED_MODULES } from "@/lib/entitlements/modules";

export const dynamic = "force-dynamic";

export default async function EmployerDashboardLayout({ children }: { children: ReactNode }) {
  const { session, tenantId } = await requireDashboardSession();

  const userLabel =
    session.email !== null && session.email.length > 0 ? session.email : session.userId;

  const modules =
    tenantId !== null
      ? await listEnabledModules(tenantId)
      : DEFAULT_ENABLED_MODULES;

  return (
    <AppShell
      role={session.profile.role}
      userLabel={userLabel}
      enabledModules={[...modules]}
      signOutSlot={<SignOutForm />}
    >
      {children}
    </AppShell>
  );
}
