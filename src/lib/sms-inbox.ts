import "server-only";
import type { Client } from "@/db/schema";
import { findClientByPhone, findClientLastTexted, getClientByIdUnsafe } from "@/lib/data/clients";
import {
  findClientLastMessaged,
  recordInboundSms,
  type InboundKind,
} from "@/lib/data/sms-messages";
import { logger } from "@/lib/logger";


/**
 * Which business an inbound text belongs to.
 *
 *  1. `To` — the number the customer texted, matched against each business's
 *     own line. The only direct signal, and the right one once businesses have
 *     their own texting numbers.
 *  2. The business that last texted this customer, per the SMS inbox log.
 *     Every outbound text currently leaves from ONE shared sending number, so
 *     (1) never matches for replies to our texts; "who were they just talking
 *     to?" is the honest answer.
 *  3. The older reminders-based lookup, which covers texts sent before the
 *     inbox log existed (and keeps working if its migration hasn't run).
 *
 * Never returns a business the customer hasn't dealt with: no match → null,
 * and the message is not stored anywhere an owner can see.
 */
export async function resolveInboundClient(to: string, from: string): Promise<Client | null> {
  if (to) {
    const byLine = await findClientByPhone(to);
    if (byLine) return byLine;
  }
  const lastMessaged = await findClientLastMessaged(from);
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
