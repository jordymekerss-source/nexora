import { NextResponse, type NextRequest } from "next/server";
import { DEMO_PERSONA_COOKIE } from "@/lib/demo/persona";
import { isDemoMode } from "@/lib/demo/mode";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);

  if (isDemoMode()) {
    const response = NextResponse.redirect(loginUrl, { status: 303 });
    response.cookies.set({
      name: DEMO_PERSONA_COOKIE,
      value: "",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(loginUrl, { status: 303 });
}
