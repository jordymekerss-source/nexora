/**
 * Deterministic demo accounts for local/E2E only.
 * Never used when NEXT_PUBLIC_DEMO_MODE is false.
 */
export const DEMO_LOGIN_ACCOUNTS = {
  employee: {
    email: "sam@nexora.local",
    password: "nexora-demo-employee",
    persona: "employee-0" as const,
    redirectTo: "/employee",
  },
  employer: {
    email: "demo@nexora.local",
    password: "nexora-demo-employer",
    persona: "employer" as const,
    redirectTo: "/employer",
  },
} as const;

export function resolveDemoLogin(
  email: string,
  password: string,
): (typeof DEMO_LOGIN_ACCOUNTS)[keyof typeof DEMO_LOGIN_ACCOUNTS] | null {
  const normalized = email.trim().toLowerCase();
  for (const account of Object.values(DEMO_LOGIN_ACCOUNTS)) {
    if (account.email === normalized && account.password === password) {
      return account;
    }
  }
  return null;
}
