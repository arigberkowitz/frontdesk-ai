/**
 * Pure helpers for the portal Messages pages — no DB, no server-only, so they
 * can be unit-tested and shared.
 */

const KIND_LABELS: Record<string, string> = {
  appointment_confirmation: "Booking confirmation",
  appointment_reminder: "Appointment reminder",
  recovery_lead: "Follow-up",
  recovery_no_show: "Missed-appointment follow-up",
  review_request: "Review request",
  recall: "Time-to-rebook reminder",
  waitlist_offer: "Waitlist opening",
  deposit_request: "Deposit request",
  lead_followup: "Follow-up",
  opt_out: "Opted out (STOP)",
  opt_in: "Opted back in",
  help: "Asked for help (HELP)",
  missed_call_text: "Missed-call text-back",
};

/** Short human label for what a message was, or null for a plain reply. */
export function messageKindLabel(kind: string | null | undefined): string | null {
  if (!kind || kind === "reply") return null;
  return KIND_LABELS[kind] ?? null;
}

/** Last ten digits — matches `callerKey`, so names from bookings/leads line up. */
function tenDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/**
 * Best name per phone from rows ordered most-recent-first (listCallerNames).
 * The first usable name for a number wins.
 */
export function buildNameIndex(
  names: { phone: string | null; name: string | null }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const key = tenDigits(n.phone);
    const name = n.name?.trim();
    if (key && name && !out[key]) out[key] = name;
  }
  return out;
}

export function nameFor(index: Record<string, string>, phone: string): string | null {
  const key = tenDigits(phone);
  return key ? (index[key] ?? null) : null;
}

/** One-line preview for the conversation list. */
export function previewText(body: string, direction: "inbound" | "outbound", max = 90): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const clipped = flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
  return direction === "outbound" ? `You: ${clipped}` : clipped;
}

/**
 * The thread URL segment is the stored customer key (digits only). Anything
 * else in the URL is rejected rather than passed to a query.
 */
export function parseThreadParam(raw: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return "";
    }
  })();
  return /^\d{10,15}$/.test(decoded) ? decoded : null;
}
