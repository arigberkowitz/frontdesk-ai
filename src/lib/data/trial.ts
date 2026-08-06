import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

export interface TrialState {
  /** On a free trial that hasn't run out. */
  active: boolean;
  /** Was on a free trial, and it has. */
  expired: boolean;
  /** Full days left, floor. Zero on the last day. */
  daysLeft: number;
  endsAt: Date | null;
  /** Someone we know, free indefinitely — no clock, no nagging. */
  comped: boolean;
  /** Paying, or mid-Stripe-trial. */
  subscribed: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

/** Where a business stands: trialing, expired, paying, or comped. */
export async function getTrialState(clientId: string): Promise<TrialState> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    with: { subscription: true },
  });
  const none: TrialState = {
    active: false,
    expired: false,
    daysLeft: 0,
    endsAt: null,
    comped: false,
    subscribed: false,
  };
  if (!client) return none;

  const comped = Boolean(client.setupFlags?.comped);
  const sub = client.subscription;
  const subscribed = Boolean(sub && (sub.status === "active" || sub.status === "trialing"));
  const endsAt = client.trialEndsAt ?? null;
  // A comped or paying business has no trial clock, whatever the column says.
  if (comped || subscribed) return { ...none, endsAt, comped, subscribed };

  if (!endsAt) return { ...none, comped, subscribed };
  const msLeft = endsAt.getTime() - Date.now();
  return {
    active: msLeft > 0,
    expired: msLeft <= 0,
    daysLeft: Math.max(0, Math.floor(msLeft / DAY)),
    endsAt,
    comped,
    subscribed,
  };
}

/**
 * May this client switch its receptionist on?
 *
 * True while a free trial is running, for a comped business, and for anyone
 * with a live subscription. An *expired* trial is deliberately not enough:
 * otherwise the twenty-one days are decorative.
 *
 * Note what this does NOT do — it doesn't take an already-answering phone line
 * away. A business whose trial lapses keeps answering its calls; it just can't
 * provision anything new until it picks a plan. Cutting a live line off on a
 * timer would punish the caller, who never agreed to anything.
 */
export async function clientMayActivate(clientId: string): Promise<boolean> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    with: { subscription: true },
  });
  if (!client) return false;
  if (client.setupFlags?.comped) return true;
  const sub = client.subscription;
  if (sub && (sub.status === "active" || sub.status === "trialing")) return true;
  if (client.status === "live") return true;
  if (client.status === "trial") {
    // No end date on a trial means it was granted before we started stamping
    // one. Treat that as still running rather than retroactively cutting
    // someone off — nobody told them there was a clock.
    return !client.trialEndsAt || client.trialEndsAt.getTime() > Date.now();
  }
  return false;
}
