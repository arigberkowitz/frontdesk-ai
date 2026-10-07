/**
 * When a business may get its own phone number.
 *
 * Every signup used to buy a Retell number the instant the form was submitted.
 * Signups are free, instant and need no card, so anyone with a few email
 * addresses could put a pile of monthly number charges on the operator's
 * vendor account. The receptionist itself (LLM + agent) still gets built at
 * signup: it costs nothing until it's called, and it's what the browser test
 * call talks to. Only the NUMBER waits.
 *
 * A number unlocks when any of these is true:
 *   - an operator is doing it (the operator dashboard can always provision);
 *   - the business pays — a Stripe subscription that is active or trialing
 *     (that is, a card on file);
 *   - it's comped, live, or an operator-approved trial (someone vouched for it);
 *   - the owner finished guided setup: every checklist step that doesn't itself
 *     need the number is done, including a test call in the browser. That's
 *     real work a throwaway signup won't do.
 *
 * Pure: the facts come from `data/number-gate.ts`, so the rules are testable.
 */

/** Checklist steps that can't be done until the number exists. */
export const NUMBER_DEPENDENT_STEPS: ReadonlySet<string> = new Set(["live", "forwarding"]);

export type NumberUnlockVia = "operator" | "card" | "comped" | "live" | "approved_trial" | "setup";

export interface NumberGateFacts {
  /** Who is asking. "system" = a webhook acting on the business's own state. */
  actorRole: "operator" | "client_admin" | "client_viewer" | "system";
  status: string;
  comped: boolean;
  /** The business's Stripe subscription status, or null with none. */
  subscriptionStatus: string | null;
  /** An operator approved this trial (trial-code flow). */
  trialApproved: boolean;
  /** Setup checklist steps (key/label/href/done) as derived from real data. */
  steps: { key: string; label: string; href: string; done: boolean }[];
}

export interface NumberGate {
  unlocked: boolean;
  via: NumberUnlockVia | null;
  /** Steps still open on the "finish setup" path (empty once it's done). */
  setupStepsLeft: { key: string; label: string; href: string }[];
}

export function numberGate(f: NumberGateFacts): NumberGate {
  const setupStepsLeft = f.steps
    .filter((s) => !NUMBER_DEPENDENT_STEPS.has(s.key) && !s.done)
    .map(({ key, label, href }) => ({ key, label, href }));
  const via: NumberUnlockVia | null =
    f.actorRole === "operator"
      ? "operator"
      : f.subscriptionStatus === "active" || f.subscriptionStatus === "trialing"
        ? "card"
        : f.comped
          ? "comped"
          : f.status === "live"
            ? "live"
            : f.status === "trial" && f.trialApproved
              ? "approved_trial"
              : // An empty checklist can't count as "finished" — guard against
                // a client whose step data didn't load.
                f.steps.length > 0 && setupStepsLeft.length === 0
                ? "setup"
                : null;
  return { unlocked: via !== null, via, setupStepsLeft };
}
