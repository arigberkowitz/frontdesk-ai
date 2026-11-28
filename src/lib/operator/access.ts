/**
 * Who may use the operator controls. Pure, so the 403 rules are unit-tested
 * without a session.
 *
 *  - Per-business controls: an operator of an AGENCY workspace, for a business
 *    in that same workspace; or the platform super-admin, for any business.
 *  - Platform-wide controls (the Orphans list): the super-admin only.
 *
 * Never a client_admin / client_viewer — those are the people these controls
 * exist to act on. The guard runs on the server for every request; hiding the
 * buttons in the portal is not the control.
 */
export interface AccessFacts {
  user: { role: "operator" | "client_admin" | "client_viewer"; orgId: string } | null;
  superAdmin: boolean;
  /** kind of the caller's own workspace */
  orgKind: string | null;
  /** workspace the target business belongs to (null for platform-wide actions) */
  targetOrgId: string | null;
}

export type AccessDecision = { ok: true } | { ok: false; status: 401 | 403; error: string };

export function decideOperatorAccess(f: AccessFacts, scope: "client" | "platform"): AccessDecision {
  if (!f.user) return { ok: false, status: 401, error: "Sign in required." };
  if (f.superAdmin) return { ok: true };
  if (scope === "platform") return { ok: false, status: 403, error: "Platform owner only." };
  if (f.user.role !== "operator" || f.orgKind !== "agency") {
    return { ok: false, status: 403, error: "Operator only." };
  }
  if (!f.targetOrgId || f.targetOrgId !== f.user.orgId) {
    return { ok: false, status: 403, error: "That business isn't in your workspace." };
  }
  return { ok: true };
}
