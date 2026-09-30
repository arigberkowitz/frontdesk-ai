/**
 * The portal Settings page, split into sections. It used to be one ~7,000px
 * scroll of eighteen cards; each section is now its own URL under
 * /portal/settings so it can be linked to, and the tab row shows everything
 * at once.
 *
 * `/portal/settings` itself is the first section (Business), so every old
 * link to "Settings" still lands somewhere sensible.
 */

export type SettingsSectionKey =
  | "business"
  | "phone"
  | "alerts"
  | "calendar"
  | "follow-ups"
  | "team"
  | "help";

export interface SettingsSection {
  key: SettingsSectionKey;
  label: string;
  href: string;
  description: string;
  /** Owners (and operators) only — staff never see the tab. The page re-checks. */
  ownerOnly?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: "business",
    label: "Business",
    href: "/portal/settings",
    description: "Your business name, timezone and languages, and your setup progress.",
  },
  {
    key: "phone",
    label: "Phone & AI",
    href: "/portal/settings/phone",
    description: "Turn your receptionist on or off, forward your line, and choose when it hands callers to a person.",
  },
  {
    key: "alerts",
    label: "Alerts",
    href: "/portal/settings/alerts",
    description: "Who hears about new bookings, messages and customer texts — and the weekly summary email.",
  },
  {
    key: "calendar",
    label: "Calendar",
    href: "/portal/settings/calendar",
    description: "Connect the calendar your AI books into and checks before offering a time.",
  },
  {
    key: "follow-ups",
    label: "Follow-ups",
    href: "/portal/settings/follow-ups",
    description: "Optional automatic texts: win back missed leads, ask for reviews, recall patients, waitlist and deposits.",
  },
  {
    key: "team",
    label: "Team access",
    href: "/portal/settings/team",
    description: "Give your staff their own sign-ins, choose who's an owner, and set the staff edit code.",
    ownerOnly: true,
  },
  {
    key: "help",
    label: "Help",
    href: "/portal/settings/help",
    description: "Reach a real person, or send us a note.",
  },
];

export function settingsSectionsFor(isOwner: boolean): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => isOwner || !s.ownerOnly);
}

export function getSettingsSection(key: SettingsSectionKey): SettingsSection {
  const s = SETTINGS_SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`Unknown settings section: ${key}`);
  return s;
}

/**
 * Old deep links into the single long Settings page used #anchors (emails
 * already sent, bookmarks, in-app links). A #hash never reaches the server,
 * so /portal/settings maps it on the client to the section that now holds it.
 */
const LEGACY_HASHES: Record<string, string> = {
  forwarding: "/portal/settings/phone#forwarding",
  handoff: "/portal/settings/phone",
  alerts: "/portal/settings/alerts",
  "weekly-summary": "/portal/settings/alerts#weekly-summary",
  roster: "/portal/settings/alerts",
  calendar: "/portal/settings/calendar",
  advanced: "/portal/settings/follow-ups#advanced",
  recovery: "/portal/settings/follow-ups",
  team: "/portal/settings/team",
  help: "/portal/settings/help",
};

export function legacySettingsHashTarget(hash: string): string | null {
  const key = hash.replace(/^#/, "").trim();
  if (!key) return null;
  return LEGACY_HASHES[key] ?? null;
}
