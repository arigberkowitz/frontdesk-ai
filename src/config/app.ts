/**
 * App-wide constants and navigation. Pure data (no server-only imports) so it
 * can be referenced from both server and client components.
 */
export const APP_NAME = "FrontDesk AI";
export const APP_TAGLINE = "Your phone, always answered.";
export const APP_DESCRIPTION =
  "AI voice receptionist for local service businesses — every call answered, booked, and captured 24/7.";

export const DEFAULT_TIMEZONE = "America/Los_Angeles";
export const DEV_PORT = 3300;

/**
 * Default recording / AI disclosure line (§12). Several states (incl. California)
 * require all-party consent to record. This is the mechanism, not legal advice —
 * the operator confirms their jurisdiction. `{{business_name}}` is interpolated
 * when the prompt is assembled.
 */
export const DEFAULT_DISCLOSURE_LINE =
  "Hi, this is the AI assistant for {{business_name}}. Just so you know, this call may be recorded.";

export type NavIcon =
  | "LayoutDashboard"
  | "Building2"
  | "Inbox"
  | "Settings"
  | "Phone"
  | "CalendarCheck"
  | "Sparkles";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
}

/** Operator (agency admin) navigation. */
export const OPERATOR_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  { label: "Clients", href: "/clients", icon: "Building2" },
  { label: "Demo", href: "/demo", icon: "Sparkles" },
  { label: "Settings", href: "/settings", icon: "Settings" },
];
