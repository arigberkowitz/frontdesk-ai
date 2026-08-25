/**
 * The typed-name gate for closing an account.
 *
 * Lives outside `actions/account.ts` because a `"use server"` module may only
 * export async functions — every export there becomes a callable server action.
 * A pure predicate wants to be unit-tested and called from both sides, so it
 * belongs in a plain module.
 */

/**
 * Does the typed confirmation match the business name?
 *
 * Case and surrounding whitespace are noise — somebody typing their own
 * business name from memory on a phone keyboard should not be defeated by a
 * capital letter. Everything else must match exactly, because the point of the
 * gate is that you cannot do this by reflex.
 */
export function confirmationMatches(typed: string, businessName: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed).length > 0 && norm(typed) === norm(businessName);
}
