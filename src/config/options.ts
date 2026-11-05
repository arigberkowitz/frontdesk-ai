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

export const INDUSTRIES = [
  "Dental",
  "Med spa",
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
  "Veterinary",
  "Chiropractic",
  "Fitness",
  "Other",
] as const;

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
