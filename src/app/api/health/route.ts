import { NextResponse } from "next/server";
import { isDemoMode, isExplicitDemoDeployment } from "@/lib/demo/mode";

export const dynamic = "force-dynamic";

export async function GET() {
  const demo = isDemoMode();
  const production = process.env["NODE_ENV"] === "production";

  if (demo && production && !isExplicitDemoDeployment()) {
    return NextResponse.json(
      {
        ok: false,
        status: "misconfigured",
        error: "DEMO_MODE enabled in production without ALLOW_DEMO_IN_PRODUCTION",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    status: "healthy",
    demoMode: demo,
    explicitDemoDeployment: isExplicitDemoDeployment(),
    nodeEnv: process.env["NODE_ENV"] ?? "undefined",
    time: new Date().toISOString(),
  });
}
