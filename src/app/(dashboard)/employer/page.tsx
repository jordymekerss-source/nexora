import { redirect } from "next/navigation";
import { requireEmployerSession } from "@/lib/auth/require-user";

/** Werkgever-start: doorsturen naar projectenoverzicht met live status. */
export default async function EmployerHomePage() {
  await requireEmployerSession();
  redirect("/employer/projects");
}
