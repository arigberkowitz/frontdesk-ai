import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Knowledge gaps against a real in-process Postgres (PGlite) with the full schema. */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const { recordKnowledgeGaps, recentGapQuestions, getKnowledgeGapSummary } = await import("./knowledge-gaps");

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../../drizzle/manual/0023_call_knowledge_gaps.sql"),
  "utf8",
);
const ORG = "00000000-0000-4000-8000-000000000001";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY = 24 * 3600 * 1000;

let n = 0;
async function call(clientId: string, opts: { daysAgo?: number; outcome?: string; deleted?: boolean } = {}) {
  n += 1;
  const id = `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await pg.query(
    `INSERT INTO calls (id, client_id, start_at, outcome, deleted_at) VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      clientId,
      new Date(Date.now() - (opts.daysAgo ?? 1) * DAY).toISOString(),
      opts.outcome ?? null,
      opts.deleted ? new Date().toISOString() : null,
    ],
  );
  return id;
}

beforeEach(async () => {
  await pg.exec(
    `DELETE FROM call_knowledge_gaps; DELETE FROM agent_suggestions; DELETE FROM knowledge_items; DELETE FROM calls; DELETE FROM clients; DELETE FROM organizations;`,
  );
  await pg.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Agency')`, [ORG]);
  await pg.query(`INSERT INTO clients (id, org_id, name) VALUES ($1, $3, 'A'), ($2, $3, 'B')`, [A, B, ORG]);
  warn.mockClear();
});

describe("migration 0023", () => {
  it("applies to a pre-feature database and is safe to run twice", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const fresh = new PGlite();
    await fresh.exec(`CREATE TABLE clients (id uuid PRIMARY KEY); CREATE TABLE calls (id uuid PRIMARY KEY);`);
    await fresh.exec(MIGRATION);
    await fresh.exec(MIGRATION);
    const t = await fresh.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'call_knowledge_gaps' ORDER BY column_name`,
    );
    expect(t.rows.map((r) => (r as { column_name: string }).column_name)).toEqual([
      "call_id",
      "client_id",
      "created_at",
      "id",
      "questions",
      "updated_at",
    ]);
  });
  it("is a no-op on a database that already matches the Drizzle schema", async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
  });
});

describe("recordKnowledgeGaps", () => {
  it("stores cleaned questions once per call", async () => {
    const c = await call(A);
    await recordKnowledgeGaps({ callId: c, clientId: A, questions: [" do you take visa? ", "Call me at 415-555-0100?"] });
    await recordKnowledgeGaps({ callId: c, clientId: A, questions: ["Something else?"] });
    const rows = await pg.query<{ questions: string[] }>(`SELECT questions FROM call_knowledge_gaps`);
    expect(rows.rows).toEqual([{ questions: ["Do you take visa?"] }]);
  });
  it("stores an empty list for a checked call with nothing missed", async () => {
    const c = await call(A);
    await recordKnowledgeGaps({ callId: c, clientId: A, questions: [] });
    const rows = await pg.query<{ questions: string[] }>(`SELECT questions FROM call_knowledge_gaps`);
    expect(rows.rows).toEqual([{ questions: [] }]);
  });
});

describe("getKnowledgeGapSummary", () => {
  it("counts the last 30 days for this business only, without spam, deleted or older calls", async () => {
    const rec = async (id: string, clientId: string, questions: string[]) =>
      recordKnowledgeGaps({ callId: id, clientId, questions });
    await rec(await call(A), A, ["Do you offer financing?"]);
    await rec(await call(A), A, ["Do you offer financing", "Is there parking?"]);
    await rec(await call(A), A, []);
    await rec(await call(A), A, []);
    await rec(await call(A, { outcome: "spam" }), A, ["Want SEO services?"]);
    await rec(await call(A, { deleted: true }), A, ["Deleted question?"]);
    await rec(await call(A, { daysAgo: 45 }), A, ["Old question?"]);
    await rec(await call(B), B, ["Other business question?"]);

    const s = await getKnowledgeGapSummary(A);
    expect(s).not.toBeNull();
    expect(s!.checked).toBe(4);
    expect(s!.withGap).toBe(2);
    expect(s!.percent).toBe(50);
    expect(s!.top.map((g) => [g.question, g.calls])).toEqual([
      ["Do you offer financing?", 2],
      ["Is there parking?", 1],
    ]);
  });

  it("narrows to the last 7 days for the weekly email", async () => {
    await recordKnowledgeGaps({ callId: await call(A, { daysAgo: 2 }), clientId: A, questions: ["Do you offer financing?"] });
    await recordKnowledgeGaps({ callId: await call(A, { daysAgo: 10 }), clientId: A, questions: ["Is there parking?"] });
    const s = await getKnowledgeGapSummary(A, 7);
    expect(s).toMatchObject({ checked: 1, withGap: 1 });
    expect(s!.top.map((g) => g.question)).toEqual(["Do you offer financing?"]);
  });

  it("returns zero checked (not a fake number) when nothing has been checked", async () => {
    await call(A);
    expect(await getKnowledgeGapSummary(A)).toEqual({ checked: 0, withGap: 0, percent: 0, top: [] });
  });

  it("links an open knowledge suggestion and marks questions already in the knowledge base", async () => {
    const c1 = await call(A);
    const c2 = await call(A);
    await recordKnowledgeGaps({ callId: c1, clientId: A, questions: ["What's the warranty on installs?"] });
    await recordKnowledgeGaps({ callId: c2, clientId: A, questions: ["Is there parking?"] });
    const [sug] = (
      await pg.query<{ id: string }>(
        `INSERT INTO agent_suggestions (client_id, type, question, rationale, evidence, status)
         VALUES ($1, 'knowledge', 'What is the warranty on an install?', 'r', $2, 'proposed') RETURNING id`,
        [A, JSON.stringify({ callIds: [c1] })],
      )
    ).rows;
    // A dismissed one never gets linked.
    await pg.query(
      `INSERT INTO agent_suggestions (client_id, type, question, rationale, evidence, status)
       VALUES ($1, 'knowledge', 'Is there parking?', 'r', $2, 'dismissed')`,
      [A, JSON.stringify({ callIds: [c2] })],
    );
    await pg.query(`INSERT INTO knowledge_items (client_id, question, answer) VALUES ($1, 'Is there parking?', 'Yes')`, [A]);

    const s = await getKnowledgeGapSummary(A);
    const warranty = s!.top.find((g) => g.question.startsWith("What's the warranty"));
    const parking = s!.top.find((g) => g.question === "Is there parking?");
    expect(warranty).toMatchObject({ suggestionId: sug.id, answered: false });
    expect(parking).toMatchObject({ suggestionId: null, answered: true });
  });

  it("recentGapQuestions lists distinct non-empty questions for the business", async () => {
    await recordKnowledgeGaps({ callId: await call(A), clientId: A, questions: ["Is there parking?"] });
    await recordKnowledgeGaps({ callId: await call(A), clientId: A, questions: ["is there parking?", "Do you offer financing?"] });
    await recordKnowledgeGaps({ callId: await call(A), clientId: A, questions: [] });
    await recordKnowledgeGaps({ callId: await call(B), clientId: B, questions: ["B only?"] });
    const qs = await recentGapQuestions(A);
    expect(qs.sort()).toEqual(["Do you offer financing?", "Is there parking?"]);
  });

  it("fails soft when the table isn't there yet (code deployed before the migration)", async () => {
    const c = await call(A);
    await pg.exec(`ALTER TABLE call_knowledge_gaps RENAME TO call_knowledge_gaps_tmp;`);
    try {
      await expect(recordKnowledgeGaps({ callId: c, clientId: A, questions: ["Q?"] })).resolves.toBeUndefined();
      expect(await getKnowledgeGapSummary(A)).toBeNull();
      expect(await recentGapQuestions(A)).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      await pg.exec(`ALTER TABLE call_knowledge_gaps_tmp RENAME TO call_knowledge_gaps;`);
    }
  });
});
