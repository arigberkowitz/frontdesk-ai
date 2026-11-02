import { env } from "@/lib/env";

/** HELP auto-reply. Contact is the configured SUPPORT_EMAIL, else the site's contact page. */
export function smsHelpReply(): string {
  const contact = env.SUPPORT_EMAIL || `${(env.APP_URL ?? "https://frontdeskai.company").replace(/\/$/, "")}/contact`;
  return `FrontDesk AI: appointment confirmations, reminders and follow-ups sent on behalf of local businesses. Msg&data rates may apply. Reply STOP to opt out. Help: ${contact}`;
}
