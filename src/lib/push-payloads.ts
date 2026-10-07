import { formatDateTime, formatPhone } from "./format";

/**
 * What a phone notification says. Pure, so it's tested without a push service.
 *
 * Lock screens are public: anyone near the phone reads them. So a notification
 * names who (the customer's name, or their number) and never what — the
 * message text, the service booked and any notes stay in the portal, one tap
 * away. A dental office's lock screen shouldn't announce "root canal".
 */
export type PushPayload = {
  title: string;
  body: string;
  /** Portal path the tap opens. Always same-origin, always under /portal. */
  url: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag: string;
};

function who(name: string | null | undefined, phone: string | null | undefined): string {
  const n = name?.trim();
  if (n) return n.length > 40 ? `${n.slice(0, 39)}…` : n;
  const p = formatPhone(phone);
  return p === "—" ? "a customer" : p;
}

export function textPushPayload(input: {
  customerPhone: string;
  name?: string | null;
  aiReplying?: boolean;
}): PushPayload {
  const digits = input.customerPhone.replace(/\D/g, "");
  return {
    title: `New text from ${who(input.name, input.customerPhone)}`,
    body: input.aiReplying
      ? "Your AI is answering. Tap to see the conversation."
      : "Tap to read and reply.",
    url: digits ? `/portal/messages/${digits}` : "/portal/messages",
    tag: `text-${digits || "unknown"}`,
  };
}

export function bookingPushPayload(input: {
  appointmentId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  startAt: Date | string;
  timeZone?: string;
}): PushPayload {
  return {
    title: `New booking: ${who(input.customerName, input.customerPhone)}`,
    body: formatDateTime(input.startAt, input.timeZone),
    url: "/portal/appointments",
    tag: `booking-${input.appointmentId}`,
  };
}

export function testPushPayload(businessName: string): PushPayload {
  return {
    title: "Notifications are on",
    body: `This is how new texts and bookings for ${businessName} will show up.`,
    url: "/portal/settings/alerts",
    tag: "test",
  };
}

/**
 * The server POSTs to whatever endpoint a browser hands us, so only accept the
 * real push services. Anything else (an internal URL, someone's own server)
 * would turn "save my device" into "make the server call this URL".
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge on Android, most Chromium
  /^android\.googleapis\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/, // Safari / iOS home-screen apps
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/, // Firefox
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/, // Edge on Windows
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return PUSH_HOSTS.some((re) => re.test(url.hostname));
}

/** "iPhone · Safari", "Android · Chrome", "Mac · Chrome"… for the device list. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux|CrOS/.test(ua)
              ? "Computer"
              : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome\/|CriOS/.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  if (device && browser) return `${device} · ${browser}`;
  return device ?? browser ?? "This device";
}
