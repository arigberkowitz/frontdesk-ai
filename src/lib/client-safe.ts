import type { Client } from "@/db/schema";

/**
 * Columns that must never reach a browser. A server page that hands a whole
 * `clients` row to a client component serializes EVERY column into the RSC
 * payload, and portal settings pages did exactly that, for staff as well as
 * owners: the encrypted calendar credential (Google/Microsoft refresh token or
 * Cal.com API key) and the edit-code hash went out with the page.
 */
export const SERVER_ONLY_CLIENT_FIELDS = ["calendarSecret", "editCodeHash"] as const;

type ServerOnlyField = (typeof SERVER_ONLY_CLIENT_FIELDS)[number];

/** What a client component may see of a business: everything but credentials. */
export type SafeClient = Omit<Client, ServerOnlyField> & {
  /** Whether an edit code is set (the one thing the UI needed from the hash). */
  hasEditCode: boolean;
};

export function toSafeClient(client: Client): SafeClient {
  const { calendarSecret: _secret, editCodeHash, ...rest } = client;
  void _secret;
  return { ...rest, hasEditCode: Boolean(editCodeHash) };
}
