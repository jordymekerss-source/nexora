import type { ReactNode } from "react";
import { requireEmployerSession } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export default async function EmployerOnlyLayout({ children }: { children: ReactNode }) {
  await requireEmployerSession();
  return children;
}
