import { cookies } from "next/headers";
import {
  DEMO_EMPLOYEE_IDS,
  DEMO_EMPLOYER_ID,
  DEMO_TENANT_ID,
} from "@/lib/demo/mode";
import type { ProfileRow } from "@/types/database";

export const DEMO_PERSONA_COOKIE = "nexora_demo_persona";

export type DemoPersona =
  | "employer"
  | "employee-0"
  | "employee-1"
  | "employee-2";

const PERSONA_PROFILES: Record<DemoPersona, ProfileRow> = {
  employer: {
    id: DEMO_EMPLOYER_ID,
    tenant_id: DEMO_TENANT_ID,
    full_name: "Demo Werkgever",
    role: "employer",
    phone: "+31 6 1234 5678",
    created_at: new Date(0).toISOString(),
  },
  "employee-0": {
    id: DEMO_EMPLOYEE_IDS[0],
    tenant_id: DEMO_TENANT_ID,
    full_name: "Sam Jansen",
    role: "employee",
    phone: null,
    created_at: new Date(0).toISOString(),
  },
  "employee-1": {
    id: DEMO_EMPLOYEE_IDS[1],
    tenant_id: DEMO_TENANT_ID,
    full_name: "Lisa de Vries",
    role: "employee",
    phone: null,
    created_at: new Date(0).toISOString(),
  },
  "employee-2": {
    id: DEMO_EMPLOYEE_IDS[2],
    tenant_id: DEMO_TENANT_ID,
    full_name: "Omar Hassan",
    role: "employee",
    phone: null,
    created_at: new Date(0).toISOString(),
  },
};

export function parseDemoPersona(value: string | undefined): DemoPersona {
  if (
    value === "employer" ||
    value === "employee-0" ||
    value === "employee-1" ||
    value === "employee-2"
  ) {
    return value;
  }
  return "employer";
}

export function getDemoPersonaFromCookies(): DemoPersona {
  const cookieStore = cookies();
  return parseDemoPersona(cookieStore.get(DEMO_PERSONA_COOKIE)?.value);
}

export function getDemoProfileForPersona(persona: DemoPersona): ProfileRow {
  return { ...PERSONA_PROFILES[persona] };
}

export function demoEmailForPersona(persona: DemoPersona): string {
  if (persona === "employer") {
    return "demo@nexora.local";
  }
  return `${persona}@nexora.local`;
}
