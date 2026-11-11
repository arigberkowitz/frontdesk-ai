/** Shared option lists for forms (client + server safe). */

export const TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

/**
 * Industries a business can pick (signup, onboarding, new client, settings).
 * No medical or health verticals for now (no Dental, Med spa, Veterinary,
 * Chiropractic) — existing businesses that saved one show as "Other" in the
 * pickers (see industryForPicker) and get the generic starter pack.
 */
export const INDUSTRIES = [
  "HVAC",
  "Plumbing",
  "Electrician",
  "Locksmith",
  "Law",
  "Salon & beauty",
  "Auto repair",
  "Home services",
  "House cleaning",
  "Pest control",
  "Fitness",
  "Other",
] as const;

export type IndustryOption = (typeof INDUSTRIES)[number];

/**
 * The picker value for a business's saved industry. A value no longer offered
 * (e.g. a retired medical vertical, or free text from an old import) maps to
 * "Other" instead of silently showing "Select…" — which would clear the saved
 * industry the next time the form is saved. Empty stays empty.
 */
export function industryForPicker(saved: string | null | undefined): IndustryOption | "" {
  const v = (saved ?? "").trim();
  if (!v) return "";
  const match = INDUSTRIES.find((i) => i.toLowerCase() === v.toLowerCase());
  return match ?? "Other";
}

export const DAYS = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
] as const;

/** Client status lifecycle (§A3). Order matters for display. */
export const CLIENT_STATUSES = ["draft", "trial", "live", "paused", "churned"] as const;

export const STATUS_LABELS: Record<(typeof CLIENT_STATUSES)[number], string> = {
  draft: "Draft",
  trial: "Trial",
  live: "Live",
  paused: "Paused",
  churned: "Churned",
};

export const CALL_OUTCOME_LABELS: Record<string, string> = {
  booked: "Booked",
  lead: "Lead captured",
  faq_answered: "FAQ answered",
  escalated: "Escalated",
  spam: "Spam",
  missed: "Missed",
  other: "Other",
};

/** What owners see in a time zone picker — the stored value stays the IANA id. */
export const TIMEZONE_LABELS: Record<(typeof TIMEZONES)[number], string> = {
  "America/Los_Angeles": "Pacific Time (Los Angeles)",
  "America/Denver": "Mountain Time (Denver)",
  "America/Phoenix": "Arizona Time (Phoenix, no daylight saving)",
  "America/Chicago": "Central Time (Chicago)",
  "America/New_York": "Eastern Time (New York, Miami)",
  "America/Anchorage": "Alaska Time (Anchorage)",
  "Pacific/Honolulu": "Hawaii Time (Honolulu)",
};

export function timezoneLabel(tz: string | null | undefined): string {
  return (tz && (TIMEZONE_LABELS as Record<string, string>)[tz]) || tz || "";
}
