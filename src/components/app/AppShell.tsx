"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  CalendarDays,
  FileText,
  FolderKanban,
  HardHat,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Timer,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { ProfileRole } from "@/types/database";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

function navForRole(role: ProfileRole): readonly NavItem[] {
  const base: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/time", label: "Uren", icon: Timer },
  ];

  if (role === "employer") {
    return [
      ...base,
      { href: "/employer/projects", label: "Projecten", icon: FolderKanban },
      { href: "/employer/clients", label: "Klanten", icon: Users },
      { href: "/employer/quotes", label: "Offertes", icon: FileText },
      { href: "/employer/invoices", label: "Facturen", icon: Receipt },
      { href: "/employer/planning", label: "Planning", icon: CalendarDays },
      { href: "/employer/fleet", label: "Wagenpark", icon: Truck },
      { href: "/employer/tools", label: "Gereedschap", icon: Wrench },
      { href: "/employer/hr", label: "HR & Certificaten", icon: HardHat },
      { href: "/dashboard/team", label: "Team", icon: Users },
    ];
  }

  if (role === "super_admin") {
    return [
      ...base,
      { href: "/dashboard/projects", label: "Projecten", icon: FolderKanban },
      { href: "/dashboard/team", label: "Team", icon: Users },
    ];
  }

  return [
    ...base,
    { href: "/employee", label: "Inklokken", icon: Timer },
    { href: "/dashboard/projects", label: "Projecten", icon: FolderKanban },
  ];
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
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
  const pathname = usePathname();
  const items = navForRole(role);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-surface-border bg-surface-elevated/95 backdrop-blur transition-transform print:hidden md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col px-4 py-6">
          <div className="flex items-start justify-between px-2">
            <div>
              <div className="font-display text-2xl font-semibold tracking-tight text-ink">
                NEXORA
              </div>
              <div className="mt-0.5 text-xs font-medium uppercase tracking-[0.18em] text-ink-muted">
                Business OS
              </div>
            </div>
            <button
              type="button"
              className="rounded-lg p-2 text-ink-muted hover:bg-accent-soft md:hidden"
              onClick={() => setOpen(false)}
              aria-label="Menu sluiten"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Hoofdnavigatie">
            {items.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-accent text-white shadow-sm"
                      : "text-ink-muted hover:bg-accent-soft/70 hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-surface-border pt-4">
            <div className="truncate px-3 text-xs text-ink-muted">{userLabel}</div>
            <div className="mt-2 px-1">{signOutSlot}</div>
          </div>
        </div>
      </aside>

      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink/30 md:hidden"
          aria-label="Overlay sluiten"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-surface-border bg-surface-elevated/90 px-4 py-3 backdrop-blur print:hidden md:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-lg p-2 text-ink-muted hover:bg-accent-soft md:hidden"
                onClick={() => setOpen(true)}
                aria-label="Menu openen"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="md:hidden">
                <div className="font-display text-lg font-semibold text-ink">NEXORA</div>
              </div>
              <div className="hidden text-sm text-ink-muted md:block">
                {role === "employer"
                  ? "Werkgever"
                  : role === "employee"
                    ? "Medewerker"
                    : role === "accountant"
                      ? "Accountant"
                      : "Beheer"}
              </div>
            </div>
            <div className="truncate text-sm font-medium text-ink">{userLabel}</div>
          </div>
        </header>
        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function SignOutForm({ children }: { children?: ReactNode }) {
  return (
    <form action="/auth/sign-out" method="post" className="inline-flex w-full">
      <button
        type="submit"
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-surface-border bg-transparent px-3 py-2 text-sm font-medium text-ink transition hover:bg-accent-soft"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {children ?? "Uitloggen"}
      </button>
    </form>
  );
}
