/**
 * Paying during the free trial must not cost the trial.
 *
 * Without this, a business that subscribes on day 3 of a 14-day trial is
 * charged that day and loses the 11 days it was promised — the people most
 * eager to pay get the worst deal. Stripe's `trial_end` carries the remaining
 * time onto the subscription: the card is saved now, first charge when the
 * trial would have ended.
 *
 * Stripe rejects a `trial_end` less than 48 hours out, so in the last two days
 * we bill straight away (the trial is effectively over), and an expired or
 * missing trial adds nothing.
 */
export const MIN_TRIAL_END_LEAD_MS = 48 * 60 * 60 * 1000;

export function checkoutTrialEnd(
  trial: { active: boolean; endsAt: Date | null },
  now: Date = new Date(),
): number | undefined {
  if (!trial.active || !trial.endsAt) return undefined;
  // A little margin over Stripe's 48h minimum so a slow checkout page can't
  // tip it under.
  if (trial.endsAt.getTime() - now.getTime() < MIN_TRIAL_END_LEAD_MS + 60 * 60 * 1000) return undefined;
  return Math.floor(trial.endsAt.getTime() / 1000);
}
