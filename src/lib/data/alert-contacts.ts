import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { alertContacts, type AlertContact, type Client } from "@/db/schema";

/** Alert-routing roster data access. Callers verify client→org ownership first. */

export async function listAlertContacts(clientId: string): Promise<AlertContact[]> {
  return db.query.alertContacts.findMany({
    where: eq(alertContacts.clientId, clientId),
    orderBy: [asc(alertContacts.createdAt)],
  });
}

export async function addAlertContact(
  clientId: string,
  input: { name: string; email: string | null; phone: string | null },
): Promise<void> {
  await db.insert(alertContacts).values({ clientId, ...input });
}

export async function setAlertContactDuty(
  clientId: string,
  contactId: string,
  onDuty: boolean,
): Promise<void> {
  await db
    .update(alertContacts)
    .set({ onDuty })
    .where(and(eq(alertContacts.id, contactId), eq(alertContacts.clientId, clientId)));
}

/** "Send to everyone": put the whole roster on duty at once. */
export async function setAllAlertContactsDuty(clientId: string, onDuty: boolean): Promise<void> {
  await db.update(alertContacts).set({ onDuty }).where(eq(alertContacts.clientId, clientId));
}

export async function deleteAlertContact(clientId: string, contactId: string): Promise<void> {
  await db
    .delete(alertContacts)
    .where(and(eq(alertContacts.id, contactId), eq(alertContacts.clientId, clientId)));
}

export interface AlertRecipients {
  emails: string[];
  phones: string[];
}

/** Who actually gets alerted right now: the on-duty roster, or (when the
 *  roster is empty/all off-duty) the business's owner email + alert phone.
 *  Fail-soft on a lagging migration → owner fallback. */
export async function getAlertRecipients(client: Client): Promise<AlertRecipients> {
  let onDuty: AlertContact[] = [];
  try {
    onDuty = (await listAlertContacts(client.id)).filter((c) => c.onDuty);
  } catch {
    onDuty = [];
  }
  const emails = onDuty.map((c) => c.email?.trim()).filter((e): e is string => Boolean(e));
  const phones = onDuty.map((c) => c.phone?.trim()).filter((p): p is string => Boolean(p));
  return {
    emails: emails.length ? emails : client.ownerEmail?.trim() ? [client.ownerEmail.trim()] : [],
    phones: phones.length
      ? phones
      : client.escalationNumber?.trim()
        ? [client.escalationNumber.trim()]
        : [],
  };
}
