/**
 * Pure helpers for the operator's suspend switch. No imports from the DB or
 * vendors, so crons, the notifier, the portal and the tests can all ask the
 * same question the same way.
 *
 * "Suspended" lives in `clients.setup_flags.suspended` (no migration) and
 * always travels with `status = 'paused'`, because most background jobs
 * already only look at live / trial businesses. This flag is what tells an
 * operator's suspension apart from the owner's own "receptionist off" pause,
 * and it is the one thing that can never be switched back on by the owner or
 * by a Stripe event.
 */

export type SuspendedFlag = NonNullable<SuspendableFlags["suspended"]>;

export interface SuspendableFlags {
  suspended?: {
    at: string;
    by: string;
    mode: "off" | "messages_only";
    previousStatus: "draft" | "trial" | "live" | "paused" | "churned";
    reason?: string;
    stripe: { action: "cancel" | "pause" | "none"; prorate: boolean };
    deleting?: boolean;
  };
}

/** Is this business suspended by an operator? Accepts a whole client row or just its flags. */
export function isSuspended(
  input: { setupFlags?: SuspendableFlags | null; deletedAt?: Date | null } | SuspendableFlags | null | undefined,
): boolean {
  if (!input) return false;
  const flags = "setupFlags" in input ? input.setupFlags : (input as SuspendableFlags);
  return Boolean(flags?.suspended);
}

/** The status a reactivated business goes back to. An owner's own pause stays a pause. */
export function statusAfterReactivate(s: SuspendedFlag): SuspendedFlag["previousStatus"] {
  return s.previousStatus;
}

/** Plain-English summary of what a suspension did, for the badge and the portal page. */
export function describeSuspension(s: SuspendedFlag): string {
  const line = s.mode === "off" ? "Phone line detached — the AI isn't answering" : "AI only takes messages";
  const stripe =
    s.stripe.action === "cancel"
      ? "Stripe subscription canceled (no refund)"
      : s.stripe.action === "pause"
        ? "Stripe billing paused"
        : "Stripe subscription left as is";
  return `${line}. ${stripe}.`;
}
