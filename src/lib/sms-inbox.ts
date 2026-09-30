import "server-only";
import type { Client } from "@/db/schema";
import { findClientByPhone, findClientLastTexted, getClientByIdUnsafe } from "@/lib/data/clients";
import { findClientBySmsNumber } from "@/lib/data/sms-numbers";
import {
  findClientLastMessaged,
  recordInboundSms,
  type InboundKind,
} from "@/lib/data/sms-messages";
import { logger } from "@/lib/logger";


/**
 * Which business an inbound text belongs to.
 *
 *  1. `To` is a business's OWN texting number (clients.sms_number) → that
 *     business. Direct and unambiguous; nothing else is consulted.
 *  2. `To` matches a business's voice line (legacy direct signal).
 *  3. Otherwise (the shared number): the business that last texted this
 *     customer FROM THE NUMBER THEY REPLIED TO, per the SMS inbox log.
 *  4. The older reminders-based lookup, which covers texts sent before the
 *     inbox log existed (and keeps working if its migration hasn't run).
 *
 * Never returns a business the customer hasn't dealt with: no match → null,
 * and the message is not stored anywhere an owner can see.
 */
export async function resolveInboundClient(to: string, from: string): Promise<Client | null> {
  if (to) {
    const own = await findClientBySmsNumber(to);
    if (own) return own;
    const byLine = await findClientByPhone(to);
    if (byLine) return byLine;
  }
  const lastMessaged = await findClientLastMessaged(from, to || null);
  if (lastMessaged) {
    // Already excludes soft-deleted businesses.
    const client = await getClientByIdUnsafe(lastMessaged);
    if (client) return client;
  }
  return (await findClientLastTexted(from)) ?? null;
}

/**
 * Resolve the tenant and store the inbound message in its inbox.
 *
 * Never throws: this runs inside the handler that processes STOP, and failing
 * to keep a copy of a message must never cost anyone their opt-out.
 * `isNew: false` means this MessageSid was already stored (a Twilio replay).
 */
export async function storeInboundMessage(input: {
  from: string;
  to: string;
  body: string;
  messageSid: string | null;
  kind: InboundKind;
}): Promise<{ owner: Client | null; isNew: boolean }> {
  let owner: Client | null = null;
  try {
    owner = await resolveInboundClient(input.to, input.from);
  } catch (err) {
    logger.error("sms.inbox.resolve_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { owner: null, isNew: true };
  }
  if (!owner) {
    logger.warn("sms.inbox.unknown_recipient", { to: input.to.replace(/\D/g, "") });
    return { owner: null, isNew: true };
  }
  const { isNew } = await recordInboundSms({
    clientId: owner.id,
    from: input.from,
    to: input.to || null,
    body: input.body,
    providerSid: input.messageSid,
    kind: input.kind,
  });
  return { owner, isNew };
}
