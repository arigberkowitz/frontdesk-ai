/**
 * The business-owner portal's navigation, in one place so the sidebar, the
 * phone "More" sheet and the ⌘K palette can never disagree.
 *
 * Grouped by the job the owner is doing, not by feature: see what came in
 * (Inbox), manage the calendar (Schedule), shape what the AI knows and says
 * (Receptionist). Settings sits apart at the bottom — it's visited monthly,
 * not daily.
 *
 * Naming note: the staff-mode provider board lives at /portal/staff and is
 * labelled "Staff" (the people customers can book with). "Team access" is the
 * owner-only Settings section for sign-ins. They used to both be called "Team".
 */

export type PortalNavKey =
  | "overview"
  | "calls"
  | "messages"
  | "leads"
  | "appointments"
  | "hours"
  | "staff"
  | "ai"
  | "services"
  | "knowledge"
  | "settings";

export interface PortalNavItem {
  key: PortalNavKey;
  label: string;
  href: string;
  /** Only shown when the business has a team (staff mode on, or not solo). */
  teamOnly?: boolean;
}

export interface PortalNavGroup {
  /** Null for the ungrouped top item (Overview) and the bottom item (Settings). */
  label: string | null;
  items: PortalNavItem[];
}

export const PORTAL_NAV_GROUPS: PortalNavGroup[] = [
  { label: null, items: [{ key: "overview", label: "Overview", href: "/portal" }] },
  {
    label: "Inbox",
    items: [
      { key: "calls", label: "Calls", href: "/portal/calls" },
      { key: "messages", label: "Messages", href: "/portal/messages" },
      { key: "leads", label: "Leads", href: "/portal/leads" },
    ],
  },
  {
    label: "Schedule",
    items: [
      { key: "appointments", label: "Appointments", href: "/portal/appointments" },
      { key: "hours", label: "Hours & time off", href: "/portal/hours" },
      { key: "staff", label: "Staff", href: "/portal/staff", teamOnly: true },
    ],
  },
  {
    label: "Receptionist",
    items: [
      { key: "ai", label: "Your AI", href: "/portal/guidelines" },
      { key: "services", label: "Services", href: "/portal/services" },
      { key: "knowledge", label: "Knowledge", href: "/portal/knowledge" },
    ],
  },
  { label: null, items: [{ key: "settings", label: "Settings", href: "/portal/settings" }] },
];

/** The groups with team-only items removed for a solo business. Empty groups drop out. */
export function portalNavFor(showTeam: boolean): PortalNavGroup[] {
  return PORTAL_NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => showTeam || !i.teamOnly),
  })).filter((g) => g.items.length > 0);
}

/** Every nav item, flat, in display order. */
export function portalNavItems(showTeam = true): PortalNavItem[] {
  return portalNavFor(showTeam).flatMap((g) => g.items);
}

export function isPortalNavActive(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}
