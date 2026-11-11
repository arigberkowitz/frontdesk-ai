/** Our lifecycle for a business's toll-free texting number. */
export type TollfreeState = "needs_number" | "needs_details" | "submitted" | "approved" | "rejected" | "error";

/** Twilio's verification status → ours. Unknown values stay "submitted" (still waiting). */
export function stateFromTwilio(status: string | null | undefined): TollfreeState {
  switch ((status ?? "").toUpperCase()) {
    case "TWILIO_APPROVED":
      return "approved";
    case "TWILIO_REJECTED":
      return "rejected";
    default:
      return "submitted";
  }
}

/** Twilio's rejection text: prefer the multi-reason list, fall back to the single field. */
export function rejectionText(v: {
  rejectionReason?: string | null;
  rejectionReasons?: Array<{ reason?: string; code?: number | string } | Record<string, unknown>> | null;
}): string | null {
  const many = (v.rejectionReasons ?? [])
    .map((r) => String((r as { reason?: unknown }).reason ?? "").trim())
    .filter(Boolean);
  if (many.length) return [...new Set(many)].join(" ");
  return v.rejectionReason?.trim() || null;
}

export interface TollfreeView {
  tone: "neutral" | "pending" | "ok" | "bad";
  title: string;
  body: string;
  /** Show the details form (first time, or to fix and resubmit). */
  showForm: boolean;
  submitLabel: string;
}

export function tollfreeView(row: {
  status: string;
  phoneNumber?: string | null;
  rejectionReason?: string | null;
  lastError?: string | null;
} | null): TollfreeView {
  const status = (row?.status ?? "needs_number") as TollfreeState;
  switch (status) {
    case "needs_number":
      return {
        tone: "neutral",
        title: "Getting your texting number",
        body: "Your toll-free number for customer texts is set up once you've finished setup on a paid plan. Meanwhile, add your business details below so carriers can approve it.",
        showForm: true,
        submitLabel: "Save details",
      };
    case "needs_details":
      return {
        tone: "neutral",
        title: "Add your business details to turn on texting",
        body: "Carriers only deliver texts from a verified business. Fill this in once and we'll submit it for you.",
        showForm: true,
        submitLabel: "Submit for approval",
      };
    case "submitted":
      return {
        tone: "pending",
        title: "Texting pending carrier approval (3–5 business days)",
        body: "Your details are with the carriers. Booking texts start automatically once they approve; your AI keeps answering and booking normally until then.",
        showForm: false,
        submitLabel: "",
      };
    case "approved":
      return {
        tone: "ok",
        title: "Texting approved",
        body: "Confirmations, reminders and follow-ups go out from your own number.",
        showForm: false,
        submitLabel: "",
      };
    case "rejected":
      return {
        tone: "bad",
        title: "Carriers didn't approve your texting number",
        body: `Reason: ${row?.rejectionReason || "No reason was given."} Fix the details below and resubmit.`,
        showForm: true,
        submitLabel: "Resubmit for approval",
      };
    case "error":
    default:
      return {
        tone: "bad",
        title: "We couldn't submit your details",
        body: `${row?.lastError ? `${row.lastError} ` : ""}Check the details below and try again; if it keeps failing, we'll sort it out.`,
        showForm: true,
        submitLabel: "Try again",
      };
  }
}
