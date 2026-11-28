import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, or, sql } from "drizzle-orm";
import twilio from "twilio";
import { db } from "@/db";
import { auditLog, clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { env } from "@/lib/env";
import { toE164 } from "@/lib/format";
import {
  TEST_SPOKEN_MESSAGE,
  claimInboundTestCall,
  WAIT_MS,
  LATE_PASS_GRACE_MS,
  type ClientForTest,
  type ForwardingTestDeps,
  type ForwardingTestStore,
  type TwilioLegStatus,
} from "@/lib/forwarding-test";

/** Postgres-backed store for the forwarding test. State lives in clients.setup_flags (no migration). */
export const forwardingTestStore: ForwardingTestStore = {
  async getClient(clientId) {
    const row = await db.query.clients.findFirst({
      where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
      columns: {
        id: true,
        name: true,
        retellPhoneNumber: true,
        forwardingNumber: true,
        escalationNumber: true,
        answeringMode: true,
        deletedAt: true,
        setupFlags: true,
      },
    });
    return (row as ClientForTest | undefined) ?? null;
  },

  async claim(clientId, test, now) {
    // "Running" = pending and still inside its wait (plus the late-pass grace).
    const staleBefore = new Date(now.getTime() - (WAIT_MS.missed_only + LATE_PASS_GRACE_MS)).toISOString();
    const rows = await db
      .update(clients)
      .set({
        setupFlags: sql`coalesce(${clients.setupFlags}, '{}'::jsonb) || jsonb_build_object('forwardingTest', ${JSON.stringify(test)}::jsonb)`,
      })
      .where(
        and(
          eq(clients.id, clientId),
          sql`not (coalesce(${clients.setupFlags}->'forwardingTest'->>'status', '') = 'pending'
            and (${clients.setupFlags}->'forwardingTest'->>'startedAt')::timestamptz > ${staleBefore}::timestamptz)`,
        ),
      )
      .returning({ id: clients.id });
    return rows.length > 0;
  },

  async patch(clientId, testId, patch) {
    await db
      .update(clients)
      .set({
        setupFlags: sql`${clients.setupFlags} || jsonb_build_object('forwardingTest', (${clients.setupFlags}->'forwardingTest') || ${JSON.stringify(patch)}::jsonb)`,
      })
      .where(and(eq(clients.id, clientId), sql`${clients.setupFlags}->'forwardingTest'->>'id' = ${testId}`));
  },

  async markPassed(clientId, testId, matchedBy, now) {
    const at = now.toISOString();
    const rows = await db
      .update(clients)
      .set({
        // A pass also switches forwarding "on" in the checklist and stamps when
        // it was proven. A late pass overrides a miss that was recorded a moment
        // earlier (webhooks can lag the poll).
        setupFlags: sql`${clients.setupFlags} || jsonb_build_object(
          'forwardingDone', true,
          'forwardingVerifiedAt', ${at}::text,
          'forwardingTest', ((${clients.setupFlags}->'forwardingTest') - 'reason')
            || jsonb_build_object('status', 'passed', 'finishedAt', ${at}::text, 'matchedBy', ${matchedBy}::text))`,
      })
      .where(
        and(
          eq(clients.id, clientId),
          sql`${clients.setupFlags}->'forwardingTest'->>'id' = ${testId}`,
          sql`${clients.setupFlags}->'forwardingTest'->>'status' in ('pending', 'failed')`,
        ),
      )
      .returning({ id: clients.id });
    return rows.length > 0;
  },

  async markFailed(clientId, testId, reason, now) {
    const rows = await db
      .update(clients)
      .set({
        setupFlags: sql`${clients.setupFlags} || jsonb_build_object(
          'forwardingTest', (${clients.setupFlags}->'forwardingTest')
            || jsonb_build_object('status', 'failed', 'finishedAt', ${now.toISOString()}::text, 'reason', ${reason}::text))`,
      })
      .where(
        and(
          eq(clients.id, clientId),
          sql`${clients.setupFlags}->'forwardingTest'->>'id' = ${testId}`,
          sql`${clients.setupFlags}->'forwardingTest'->>'status' = 'pending'`,
        ),
      )
      .returning({ id: clients.id });
    return rows.length > 0;
  },

  async runsSince(clientId, since) {
    const rows = await db
      .select({ at: auditLog.createdAt })
      .from(auditLog)
      .where(
        and(eq(auditLog.clientId, clientId), eq(auditLog.action, "forwarding.test_placed"), gte(auditLog.createdAt, since)),
      )
      .orderBy(asc(auditLog.createdAt));
    return rows.map((r) => r.at);
  },

  async runsToNumberSince(e164, since) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "forwarding.test_placed"),
          gte(auditLog.createdAt, since),
          sql`${auditLog.detail}->>'to' = ${e164}`,
        ),
      );
    return row?.n ?? 0;
  },

  async logPlaced(clientId, actor, detail) {
    await audit({ clientId, actor, action: "forwarding.test_placed", detail });
  },

  async logResult(clientId, detail) {
    await audit({ clientId, actor: "system", action: "forwarding.test_result", detail });
  },
};

/** The test call itself: ring the business line, say one sentence, hang up. Never retried. */
export function forwardingTestDeps(): ForwardingTestDeps {
  const from = toE164(env.FORWARDING_TEST_FROM_NUMBER || env.TWILIO_FROM_NUMBER);
  const hasCreds = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
  const client = () => twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return {
    store: forwardingTestStore,
    fromNumber: hasCreds ? from : null,
    now: () => new Date(),
    newId: () => randomUUID(),
    async placeCall({ to, from: f, ringSeconds }) {
      // Inline TwiML: nothing for Twilio to fetch from us, so no public URL to
      // protect. If the line answers (a person, voicemail, or the AI before we
      // turn it away) we say one sentence and hang up within seconds.
      const call = await client().calls.create({
        to,
        from: f,
        timeout: ringSeconds,
        twiml: `<Response><Say>${TEST_SPOKEN_MESSAGE}</Say><Pause length="3"/><Hangup/></Response>`,
      });
      return { sid: call.sid };
    },
    async fetchCallStatus(sid) {
      const call = await client().calls(sid).fetch();
      return { status: call.status as TwilioLegStatus, endedAt: call.endTime ?? null };
    },
  };
}

/**
 * The Retell webhook asks this for every incoming call: is it our own test
 * call? Looks the business up by agent or by the number that rang, then
 * matches the caller against the running test. Never throws: a database hiccup
 * must not turn a customer's call into a "test".
 */
export async function claimInboundForwardingTest(info: {
  agentId?: string | null;
  toNumber?: string | null;
  fromNumber?: string | null;
}): Promise<boolean> {
  try {
    if (!info.fromNumber) return false;
    const byAgent = info.agentId ? eq(clients.retellAgentId, info.agentId) : null;
    const byNumber = info.toNumber ? eq(clients.retellPhoneNumber, info.toNumber) : null;
    const where = byAgent && byNumber ? or(byAgent, byNumber) : (byAgent ?? byNumber);
    if (!where) return false;
    const row = await db.query.clients.findFirst({
      where: and(where, isNull(clients.deletedAt), sql`${clients.setupFlags} ? 'forwardingTest'`),
      columns: {
        id: true,
        retellPhoneNumber: true,
        forwardingNumber: true,
        answeringMode: true,
        setupFlags: true,
      },
    });
    if (!row) return false;
    return await claimInboundTestCall(forwardingTestStore, { ...row, deletedAt: null }, info.fromNumber, new Date());
  } catch {
    return false;
  }
}
