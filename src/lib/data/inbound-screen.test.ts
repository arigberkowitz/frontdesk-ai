import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Inbound screening against a real (in-process) Postgres with the full schema:
 * which business a ringing call belongs to, how the caller's number is matched
 * in the call log, and the 30-day window.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { screenInboundCall } = await import("./inbound-screen");

const NOW = new Date("2026-11-27T20:00:00.000Z");
const DAY = 86_400_000;
let clientId = "";

async function call(from: string, daysAgo: number, outcome: (typeof schema.calls.$inferInsert)["outcome"] = "spam") {
  const [c] = await db
    .insert(schema.calls)
    .values({
      clientId,
      retellCallId: `call_${Math.random()}`,
      fromNumber: from,
      startAt: new Date(NOW.getTime() - daysAgo * DAY),
      durationSec: 20,
      outcome,
    })
    .returning();
  return c!;
}
const screen = (fromNumber: string | null, more: { agentId?: string | null; toNumber?: string | null } = {}) =>
  screenInboundCall({ agentId: "agent_1", toNumber: "+14155550000", fromNumber, ...more }, NOW);

beforeEach(async () => {
  await db.delete(schema.leads);
  await db.delete(schema.appointments);
  await db.delete(schema.calls);
  await db.delete(schema.clients);
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({
      orgId: org!.id,
      name: "Mission Plumbing",
      status: "live",
      retellAgentId: "agent_1",
      retellPhoneNumber: "+14155550000",
      setupFlags: { blockedNumbers: ["4155550134"] },
    })
    .returning();
  clientId = c!.id;
});

describe("screenInboundCall", () => {
  it("rejects a blocked number, found by agent id or by the number dialled", async () => {
    expect(await screen("+14155550134")).toEqual({ clientId, screen: { reject: true, reason: "blocked" } });
    expect((await screen("+14155550134", { agentId: null })).screen.reject).toBe(true);
    expect((await screen("+14155550134", { agentId: "agent_other", toNumber: null })).clientId).toBeNull();
  });

  it("unknown agent and number: let it through", async () => {
    expect(await screen("+14155550134", { agentId: "nope", toNumber: "+19999999999" })).toEqual({
      clientId: null,
      screen: { reject: false, reason: null },
    });
  });

  it("3 spam calls in 30 days rejects — matched however the number was stored", async () => {
    await call("+1 415-555-0199", 1);
    await call("4155550199", 5);
    expect((await screen("+14155550199")).screen.reject).toBe(false);
    await call("(415) 555-0199", 20);
    expect((await screen("+14155550199")).screen).toEqual({ reject: true, reason: "repeat_spam" });
  });

  it("spam older than 30 days doesn't count", async () => {
    await call("+14155550199", 1);
    await call("+14155550199", 2);
    await call("+14155550199", 31);
    expect((await screen("+14155550199")).screen.reject).toBe(false);
  });

  it("a lead or a booking from that number keeps it answered", async () => {
    for (const d of [1, 2, 3]) await call("+14155550199", d);
    const real = await call("+14155550199", 4, "faq_answered");
    await db.insert(schema.leads).values({ clientId, callId: real.id, name: "Pat", phone: "+14155550199" });
    expect((await screen("+14155550199")).screen.reject).toBe(false);

    await db.delete(schema.leads);
    await db.insert(schema.appointments).values({ clientId, callId: real.id, startAt: NOW });
    expect((await screen("+14155550199")).screen.reject).toBe(false);
  });

  it("another business's spam doesn't count here", async () => {
    const [org] = await db.insert(schema.organizations).values({ name: "Other", kind: "agency" }).returning();
    const [other] = await db.insert(schema.clients).values({ orgId: org!.id, name: "Other Co", status: "live" }).returning();
    for (const d of [1, 2, 3]) {
      await db.insert(schema.calls).values({
        clientId: other!.id,
        retellCallId: `o_${d}`,
        fromNumber: "+14155550199",
        startAt: new Date(NOW.getTime() - d * DAY),
        outcome: "spam",
      });
    }
    expect((await screen("+14155550199")).screen.reject).toBe(false);
  });

  it("withheld caller ID is always answered", async () => {
    expect((await screen(null)).screen.reject).toBe(false);
    expect((await screen("anonymous")).screen.reject).toBe(false);
  });

  it("a number the owner let through is answered despite 3 spam calls", async () => {
    for (const d of [1, 2, 3]) await call("+14155550199", d);
    await db.update(schema.clients).set({ setupFlags: { blockedNumbers: [], allowedNumbers: ["4155550199"] } });
    expect((await screen("+14155550199")).screen.reject).toBe(false);
  });
});
