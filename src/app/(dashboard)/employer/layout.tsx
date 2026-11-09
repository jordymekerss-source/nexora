import Link from "next/link";
import type { ReactNode } from "react";
import {
  CalendarDays,
  FileText,
  FolderKanban,
  HardHat,
  Receipt,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { PersonaSwitcher } from "@/components/demo/PersonaSwitcher";
import { requireEmployerSession } from "@/lib/auth/require-user";
import { isDemoMode } from "@/lib/demo/mode";
import { getDemoPersonaFromCookies } from "@/lib/demo/persona";
import { seedDemoStoreIfEmpty } from "@/lib/demo/store";

export const dynamic = "force-dynamic";

const employerLinks = [
  { href: "/employer/clients", label: "Klanten", icon: Users },
  { href: "/employer/quotes", label: "Offertes", icon: FileText },
  { href: "/employer/invoices", label: "Facturen", icon: Receipt },
  { href: "/employer/planning", label: "Planning", icon: CalendarDays },
  { href: "/employer/projects", label: "Projecten", icon: FolderKanban },
  { href: "/employer/fleet", label: "Wagenpark", icon: Truck },
  { href: "/employer/tools", label: "Gereedschap", icon: Wrench },
  { href: "/employer/hr", label: "HR & Certificaten", icon: HardHat },
] as const;

export default async function EmployerOnlyLayout({ children }: { children: ReactNode }) {
  await requireEmployerSession();

  if (isDemoMode()) {
    await seedDemoStoreIfEmpty(false);
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden flex flex-wrap gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
        {employerLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              <Icon className="h-4 w-4 text-accent" aria-hidden />
              {link.label}
            </Link>
          );
        })}
      </div>
      {isDemoMode() ? (
        <div className="print:hidden rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
            Demo · wissel naar medewerker voor inklokken
          </div>
          <PersonaSwitcher current={getDemoPersonaFromCookies()} />
        </div>
      ) : null}
      {children}
    </div>
  );
}
