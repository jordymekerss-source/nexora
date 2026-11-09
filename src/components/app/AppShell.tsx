import Link from "next/link";
import type { ReactNode } from "react";
import {
  CalendarDays,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Receipt,
  Timer,
  Users,
} from "lucide-react";
import type { ProfileRole } from "@/types/database";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

function navForRole(role: ProfileRole): readonly NavItem[] {
  const base: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/time", label: "Time", icon: Timer },
  ];

  if (role === "employer") {
    return [
      ...base,
      { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
      { href: "/employer/clients", label: "Klanten", icon: Users },
      { href: "/employer/quotes", label: "Offertes", icon: FileText },
      { href: "/employer/invoices", label: "Facturen", icon: Receipt },
      { href: "/employer/planning", label: "Planning", icon: CalendarDays },
      { href: "/dashboard/team", label: "Team", icon: Users },
    ];
  }

  if (role === "super_admin") {
    return [
      ...base,
      { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
      { href: "/dashboard/team", label: "Team", icon: Users },
    ];
  }

  return [...base, { href: "/dashboard/projects", label: "Projects", icon: FolderKanban }];
}

export function AppShell({
  role,
  userLabel,
  signOutSlot,
  children,
}: {
  role: ProfileRole;
  userLabel: string;
  signOutSlot: ReactNode;
  children: ReactNode;
}) {
  const items = navForRole(role);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 flex-shrink-0 border-r border-zinc-800 bg-surface md:block print:hidden">
        <div className="flex h-full flex-col px-4 py-6">
          <div className="px-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              NEXORA
            </div>
            <div className="mt-1 text-lg font-semibold text-zinc-100">Business OS</div>
          </div>
          <nav className="mt-8 flex flex-1 flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                >
                  <Icon className="h-4 w-4 text-accent" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-zinc-800 pt-4">
            <div className="truncate px-3 text-xs text-zinc-500">{userLabel}</div>
            <div className="mt-2 px-1">{signOutSlot}</div>
          </div>
        </div>
      </aside>
      <main className="flex-1">
        <div className="border-b border-zinc-800 bg-surface/80 px-6 py-4 backdrop-blur md:hidden print:hidden">
          <div className="text-sm font-semibold text-zinc-100">NEXORA</div>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
      </main>
    </div>
  );
}

export function SignOutForm({ children }: { children?: ReactNode }) {
  return (
    <form action="/auth/sign-out" method="post" className="inline-flex w-full">
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:text-white"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {children ?? "Sign out"}
      </button>
    </form>
  );
}
