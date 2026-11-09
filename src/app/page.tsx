import { redirect } from "next/navigation";
import { getAuthenticatedSession } from "@/lib/auth/require-user";
import { isDemoMode } from "@/lib/demo/mode";
import { seedDemoStoreIfEmpty } from "@/lib/demo/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (isDemoMode()) {
    await seedDemoStoreIfEmpty(false);
    redirect("/employer/clients");
  }

  const session = await getAuthenticatedSession();
  if (session === null) {
    redirect("/login");
  }
  redirect("/dashboard");
}
