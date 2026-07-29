/**
 * Industry vocabulary: the portal and voice agent speak the business's
 * language — a law firm has clients and consultations, a clinic has patients
 * and visits. Pure (no DB / no server-only) so prompt.ts can use it too.
 *
 * Applies to user-facing PORTAL copy and the agent prompt only — never to
 * code identifiers, DB fields, routes, or nav labels.
 */
export interface Vocab {
  customer: string;
  customers: string;
  appointment: string;
  appointments: string;
}

const DEFAULT_VOCAB: Vocab = {
  customer: "customer",
  customers: "customers",
  appointment: "appointment",
  appointments: "appointments",
};

/** First keyword match wins; matched case-insensitively against the industry string. */
const RULES: Array<[RegExp, Vocab]> = [
  [
    /law|legal|attorney/,
    { customer: "client", customers: "clients", appointment: "consultation", appointments: "consultations" },
  ],
  [
    /dental|medical|health|clinic|chiro|therap/,
    { customer: "patient", customers: "patients", appointment: "visit", appointments: "visits" },
  ],
  [
    /restaurant|cafe|food/,
    { customer: "guest", customers: "guests", appointment: "reservation", appointments: "reservations" },
  ],
  [
    /salon|barber|spa/,
    { customer: "client", customers: "clients", appointment: "appointment", appointments: "appointments" },
  ],
];

/** Vocabulary for an industry string (e.g. client.industry). Falls back to customer/appointment. */
export function vocabFor(industry: string | null | undefined): Vocab {
  const needle = (industry ?? "").toLowerCase();
  if (needle) {
    for (const [pattern, vocab] of RULES) {
      if (pattern.test(needle)) return vocab;
    }
  }
  return DEFAULT_VOCAB;
}

/** True when the industry maps to anything other than customer/appointment. */
export function hasCustomVocab(v: Vocab): boolean {
  return v.customer !== DEFAULT_VOCAB.customer || v.appointment !== DEFAULT_VOCAB.appointment;
}

/** Capitalize a vocab word for titles: "consultations" → "Consultations". */
export function capVocab(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
