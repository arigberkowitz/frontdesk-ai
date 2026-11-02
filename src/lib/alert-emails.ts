/**
 * Email recipients for an owner alert. Until texting is carrier-approved
 * (SMS_ENABLED), the owner's own email is always included, so an alert never
 * depends on a text that might not be delivered.
 */
export function alertEmails(contactEmails: string[], ownerEmail: string | null | undefined, smsEnabled: boolean): string[] {
  const owner = ownerEmail?.trim();
  if (!contactEmails.length) return owner ? [owner] : [];
  if (!smsEnabled && owner && !contactEmails.includes(owner)) return [...contactEmails, owner];
  return contactEmails;
}
