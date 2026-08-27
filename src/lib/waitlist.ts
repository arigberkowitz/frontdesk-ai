/**
 * Who gets offered a slot that just opened up.
 *
 * A cancellation is the most perishable inventory a service business has:
 * Thursday at 2 is worth something on Wednesday and nothing on Friday. The
 * matching rules are pure so they can be tested without a database, because
 * the cost of getting them wrong is texting the wrong person about a time they
 * never wanted.
 */

/** Nobody gets offered more than this many openings, ever. */
export const MAX_OFFERS_PER_ENTRY = 3;
/** How many people we tell about a single freed slot. */
export const MAX_PEOPLE_PER_OPENING = 3;
/** Don't offer a slot that's about to start — they can't get there. */
export const MIN_NOTICE_HOURS = 2;

export interface WaitlistCandidate {
  id: string;
  customerPhone: string;
  serviceId: string | null;
  earliestAt: Date;
  latestAt: Date;
  status: string;
  notifyCount: number;
  createdAt: Date;
}

export interface Opening {
  startAt: Date;
  endAt: Date | null;
  serviceId: string | null;
}

/**
 * Does this freed slot fall inside what they said they'd take?
 *
 * Service has to match when both sides name one. A caller waiting for a root
 * canal does not want a text about a teeth-whitening slot, and an entry with no
 * service recorded is a caller who didn't specify — those match anything.
 */
export function matchesOpening(
  entry: WaitlistCandidate,
  opening: Opening,
  now: Date,
): boolean {
  if (entry.status !== "waiting") return false;
  if (!entry.customerPhone.trim()) return false;
  if (entry.notifyCount >= MAX_OFFERS_PER_ENTRY) return false;

  // Their window has already passed — this entry is dead, not eligible.
  if (entry.latestAt.getTime() < now.getTime()) return false;

  const hoursOfNotice = (opening.startAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursOfNotice < MIN_NOTICE_HOURS) return false;

  if (entry.serviceId && opening.serviceId && entry.serviceId !== opening.serviceId) return false;

  const start = opening.startAt.getTime();
  return start >= entry.earliestAt.getTime() && start <= entry.latestAt.getTime();
}

/**
 * Pick who to tell, oldest waiting first.
 *
 * First-come-first-served is the only ordering a customer would call fair, and
 * it's the only one an owner can defend out loud when two people wanted the
 * same Thursday.
 */
export function chooseOffers(
  entries: WaitlistCandidate[],
  opening: Opening,
  now: Date,
  limit = MAX_PEOPLE_PER_OPENING,
): WaitlistCandidate[] {
  return entries
    .filter((e) => matchesOpening(e, opening, now))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, limit);
}

/**
 * The offer text. Templated, never model-written.
 *
 * It names the time plainly and tells them how to take it. It does NOT claim
 * the slot is held for them — it isn't, three people got this text, and
 * promising otherwise is how a business ends up apologising to two of them.
 */
export function waitlistOfferBody(input: {
  businessName: string;
  customerName: string | null;
  serviceName: string | null;
  when: string;
  callbackNumber?: string | null;
}): string {
  const clean = (v: string | null, max: number) =>
    (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const name = clean(input.customerName, 40);
  const business = clean(input.businessName, 60);
  const service = clean(input.serviceName, 40);
  const callback = input.callbackNumber?.trim();

  return (
    `Hi${name ? ` ${name}` : ""}, it's ${business} — a spot just opened up${service ? ` for ${service}` : ""} on ${input.when}. ` +
    `First to reply gets it.` +
    (callback ? ` Call or text ${callback} to take it.` : "") +
    ` Reply STOP to opt out.`
  );
}

/** "Thursday at 2:00 PM", in the business's own timezone. */
export function describeOpening(startAt: Date, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone ?? "America/Los_Angeles",
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(startAt);
  } catch {
    return startAt.toISOString();
  }
}
