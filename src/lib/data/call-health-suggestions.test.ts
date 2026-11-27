import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The "worth blocking" suggestions on Overview → Call health: repeat spam
 * (2+ spam calls) and repeat silent callers (3+ calls, nothing said, never a
 * real conversation). Suggestions only — nothing here blocks anyone.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { getCallHealth } = await import("./calls");

let clientId = "";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000);

async function call(from: string, h: number, v: Partial<typeof schema.calls.$inferInsert>) {
  await db.insert(schema.calls).values({ clientId, retellCallId: `c_${Math.random()}`, fromNumber: from, startAt: ago(h), ...v });
}
const silent = { durationSec: 5, transcript: "Agent: Thanks for calling Mission Plumbing.", outcome: "faq_answered" as const };
const talk = { durationSec: 95, transcript: "Agent: Hi\nUser: My water heater is leaking", outcome: "faq_answered" as const };

beforeEach(async () => {
  await db.delete(schema.calls);
  await db.delete(schema.clients);
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db.insert(schema.clients).values({ orgId: org!.id, name: "Mission Plumbing", status: "live" }).returning();
  clientId = c!.id;
});

describe("getCallHealth suggestedBlocks", () => {
  it("lists repeat spam and repeat silent callers, labelled, and nobody who ever talked", async () => {
    await call("+14155550199", 1, { outcome: "spam", durationSec: 30 });
    await call("+14155550199", 2, { outcome: "spam", durationSec: 30 });
    for (const h of [3, 4, 5]) await call("+14155550111", h, silent);
    // A regular who pocket-dialled three times but also called for real once.
    for (const h of [3, 4, 5]) await call("+14155550122", h, silent);
    await call("+14155550122", 6, talk);
    // Two silent calls: not enough.
    for (const h of [3, 4]) await call("+14155550133", h, silent);

    const { suggestedBlocks } = await getCallHealth(clientId);
    expect(suggestedBlocks.map((s) => [s.phone, s.reason, s.calls])).toEqual([
      ["4155550199", "spam", 2],
      ["4155550111", "silent", 3],
    ]);
  });

  it("a number that is both spam and silent is listed once, as spam", async () => {
    for (const h of [1, 2]) await call("+14155550199", h, { ...silent, outcome: "spam" });
    await call("+14155550199", 3, silent);
    const { suggestedBlocks } = await getCallHealth(clientId);
    expect(suggestedBlocks.map((s) => [s.phone, s.reason])).toEqual([["4155550199", "spam"]]);
  });

  it("3+ spam calls: listed as turned away (not as a suggestion) until the owner lets it through", async () => {
    for (const h of [1, 2, 3]) await call("+14155550199", h, { outcome: "spam", durationSec: 20 });
    let health = await getCallHealth(clientId);
    expect(health.autoRejected.map((a) => a.phone)).toEqual(["4155550199"]);
    expect(health.suggestedBlocks).toEqual([]);

    await db.update(schema.clients).set({ setupFlags: { allowedNumbers: ["4155550199"] } });
    health = await getCallHealth(clientId);
    expect(health.autoRejected).toEqual([]);
  });
});
