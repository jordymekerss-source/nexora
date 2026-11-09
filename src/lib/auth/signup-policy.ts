/**
 * Pure policy helpers documenting/enforcing signup privilege rules in tests.
 * The database trigger is the real enforcement; this mirrors its contract.
 */

export type SignupBootstrapInput = {
  rawRole: string | null | undefined;
  rawTenantId: string | null | undefined;
  invitedAt: string | null | undefined;
  email: string;
  openInviteTenantId: string | null;
};

export type SignupBootstrapResult = {
  role: "employee";
  tenantId: string | null;
};

/**
 * Public metadata never grants privileges. Invites bind tenant only via invite ledger.
 */
export function resolveSignupBootstrap(input: SignupBootstrapInput): SignupBootstrapResult {
  const invited = input.invitedAt !== null && input.invitedAt !== undefined && input.invitedAt.length > 0;
  if (invited && input.openInviteTenantId !== null) {
    return { role: "employee", tenantId: input.openInviteTenantId };
  }
  // Even if attacker sends role=super_admin|employer and a tenant_id, ignore them.
  void input.rawRole;
  void input.rawTenantId;
  return { role: "employee", tenantId: null };
}
