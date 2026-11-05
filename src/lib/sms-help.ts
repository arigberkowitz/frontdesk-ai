import { env } from "@/lib/env";
import { SUPPORT_EMAIL } from "@/config/contact";

/** HELP auto-reply. Contact is the configured support address. */
export function smsHelpReply(): string {
  const contact = env.SUPPORT_EMAIL || SUPPORT_EMAIL;
  return `FrontDesk AI: appointment confirmations, reminders and follow-ups sent on behalf of local businesses. Msg&data rates may apply. Reply STOP to opt out. Help: ${contact}`;
}

/**
 * Opt-in confirmation sent when someone texts START / UNSTOP. Carriers require
 * one; it names the program, frequency, rates, HELP and STOP. STOP stays in
 * English because it's the carrier keyword.
 */
export function smsOptInReply(language?: string | null): string {
  if ((language ?? "").toLowerCase().startsWith("es")) {
    return "FrontDesk AI: Se ha suscrito de nuevo a los mensajes de citas del negocio que contactó. La frecuencia varía. Pueden aplicarse tarifas de mensajes y datos. Responda HELP para ayuda o STOP para cancelar.";
  }
  return "FrontDesk AI: You're re-subscribed to appointment texts from the business you contacted. Msg frequency varies. Msg&data rates may apply. Reply HELP for help, STOP to opt out.";
}
