import type { ModuleKey } from "@/lib/entitlements/modules";
import type { ProfileRole } from "@/types/database";

export type NavItemConfig = {
  href: string;
  label: string;
  moduleKey?: ModuleKey | "platform";
  roles: readonly ProfileRole[];
};

/** Single source of truth for role+module navigation (web + future mobile). */
export const NAV_CATALOG: readonly NavItemConfig[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["employer", "employee", "super_admin", "accountant"] },
  { href: "/dashboard/time", label: "Uren", moduleKey: "time", roles: ["employer", "employee", "super_admin"] },
  { href: "/employee", label: "Vandaag", moduleKey: "time", roles: ["employee"] },
  { href: "/employer/projects", label: "Projecten", moduleKey: "projects", roles: ["employer"] },
  { href: "/dashboard/projects", label: "Projecten", moduleKey: "projects", roles: ["employee", "super_admin"] },
  { href: "/employer/clients", label: "Klanten", moduleKey: "crm", roles: ["employer"] },
  { href: "/employer/quotes", label: "Offertes", moduleKey: "billing", roles: ["employer"] },
  { href: "/employer/invoices", label: "Facturen", moduleKey: "billing", roles: ["employer"] },
  { href: "/employer/planning", label: "Planning", moduleKey: "planning", roles: ["employer"] },
  { href: "/employer/fleet", label: "Wagenpark", moduleKey: "fleet", roles: ["employer"] },
  { href: "/employer/tools", label: "Gereedschap", moduleKey: "tools", roles: ["employer"] },
  { href: "/employer/hr", label: "HR & Certificaten", moduleKey: "hr", roles: ["employer"] },
  { href: "/dashboard/team", label: "Team", moduleKey: "hr", roles: ["employer", "super_admin"] },
];

export function buildNavForSession(input: {
  role: ProfileRole;
  enabledModules: ReadonlySet<string>;
}): NavItemConfig[] {
  return NAV_CATALOG.filter((item) => {
    if (!item.roles.includes(input.role)) {
      return false;
    }
    if (item.moduleKey === undefined || item.moduleKey === "platform") {
      return true;
    }
    // Super Admin without modules list: hide tenant modules (support tools separate).
    if (input.role === "super_admin") {
      return false;
    }
    return input.enabledModules.has(item.moduleKey);
  });
}
