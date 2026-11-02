/**
 * Owners see why a text didn't go through in plain words. The stored
 * `sms_messages.error` is the carrier/vendor detail (codes, provider names) and
 * is for us; this maps the few cases an owner can act on and hides the rest.
 */
export function friendlySmsFailure(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/\b21610\b|unsubscribed|opted out|stop/.test(s)) return "they've opted out of texts from you";
  if (/\b(21211|21614|30006|21408)\b|not a valid|landline|unreachable|invalid .*number/.test(s)) {
    return "that number can't receive texts";
  }
  return null;
}
