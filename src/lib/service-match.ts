/**
 * Matching what a caller said to a service on the menu.
 *
 * The old rule was "first name that contains the words, in whatever order the
 * database returned them", over every service including retired ones. A firm
 * with "Consultation" and "Consultation — Follow-up" booked whichever row came
 * back first, and a service the owner had switched off could still be booked by
 * name. Both failures are silent: the caller is told they're booked, and the
 * wrong thing is on the calendar.
 *
 * Pure, so the rules are testable without a database.
 */

export interface ServiceLike {
  id?: string;
  name: string;
  isActive?: boolean | null;
}

export type ServiceMatch<T extends ServiceLike> =
  | { kind: "exact"; service: T }
  | { kind: "none"; options: T[] }
  /** Two or more equally good readings — ask rather than pick. */
  | { kind: "ambiguous"; options: T[] };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a spoken service name against the menu. Only active services are
 * bookable; inactive ones stay visible to the matcher solely so we don't offer
 * them as alternatives.
 */
export function matchService<T extends ServiceLike>(spoken: string, services: T[]): ServiceMatch<T> {
  const active = services.filter((s) => s.isActive !== false);
  const wanted = normalize(spoken);
  if (!wanted) return { kind: "none", options: active };
  if (active.length === 0) return { kind: "none", options: [] };

  // Tiers, best first. Within a tier, more than one hit means we genuinely
  // don't know which one they meant.
  const tiers = [
    active.filter((s) => normalize(s.name) === wanted),
    active.filter((s) => normalize(s.name).startsWith(wanted)),
    active.filter((s) => normalize(s.name).includes(wanted)),
    // Last resort: they said more than the menu does ("a teeth cleaning
    // please") — match when every word of the service name appears in what
    // they said.
    active.filter((s) => {
      const words = normalize(s.name).split(" ").filter(Boolean);
      return words.length > 0 && words.every((w) => wanted.includes(w));
    }),
  ];

  for (const tier of tiers) {
    if (tier.length === 1) return { kind: "exact", service: tier[0] };
    if (tier.length > 1) return { kind: "ambiguous", options: tier };
  }
  return { kind: "none", options: active };
}

/** The sentence the agent should say when it can't pin the service down. */
export function serviceClarification<T extends ServiceLike>(match: ServiceMatch<T>): string {
  const names = ("options" in match ? match.options : []).map((s) => s.name);
  if (!names.length) return "I'm not sure which service that is — could you say it again?";
  if (match.kind === "ambiguous") {
    return `We have a couple that sound like that — ${names.join(" and ")}. Which one did you want?`;
  }
  return `I want to book the right thing — we offer ${names.join(", ")}. Which would you like?`;
}
