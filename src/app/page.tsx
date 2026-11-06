import { redirect } from "next/navigation";
import { getAuthenticatedSession } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getAuthenticatedSession();
  if (session === null) {
    redirect("/login");
  }
  redirect("/dashboard");
}
