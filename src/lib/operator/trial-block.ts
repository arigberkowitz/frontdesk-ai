/**
 * Fraud flag: identities (email, phone, company domain) that an operator
 * deleted a company for, so the same person can't just sign up again for
 * another free trial.
 *
 * Stored as `audit_log` rows (action `trial.blocked_identity`) rather than in
 * a new table: the audit log survives the 90-day purge of the business (its
 * `client_id` just goes null), which is exactly the lifetime a block needs, and
 * it means no migration. The identity is kept lower-cased / digits-only; it is
 * never shown to the customer.
 */

export const TRIAL_BLOCK_ACTION = "trial.blocked_identity";

export interface BlockedIdentity {
  emails: string[];
  phones: string[];
  /** Company domain; null for free mail providers (everyone with @gmail.com is not one company). */
  domain: string | null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** Last ten digits, the same key the spam / opt-out code uses. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export function identityFrom(
  parts: { emails: (string | null | undefined)[]; phones: (string | null | undefined)[] },
  isFreeDomain: (domain: string) => boolean,
): BlockedIdentity {
  const emails = [...new Set(parts.emails.map(normalizeEmail).filter((e): e is string => Boolean(e)))];
  const phones = [...new Set(parts.phones.map(normalizePhone).filter((p): p is string => Boolean(p)))];
  const domains = [...new Set(emails.map((e) => e.split("@")[1]!).filter((d) => !isFreeDomain(d)))];
  // One company domain per deleted business; if several differ, keep the first
  // (the owner's) rather than banning an unrelated company.
  return { emails, phones, domain: domains[0] ?? null };
}

/** Does a signup match a stored block? Pure, for the tests. */
export function matchesBlock(
  blocks: BlockedIdentity[],
  who: { emails: (string | null | undefined)[]; phones: (string | null | undefined)[] },
  isFreeDomain: (domain: string) => boolean,
): boolean {
  const probe = identityFrom(who, isFreeDomain);
  return blocks.some(
    (b) =>
      b.emails.some((e) => probe.emails.includes(e)) ||
      b.phones.some((p) => probe.phones.includes(p)) ||
      Boolean(b.domain && probe.domain === b.domain),
  );
}
