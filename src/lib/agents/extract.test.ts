import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Post-call extraction records knowledge gaps from the SAME model call it
 * already makes (no second call), and skips spam. Real schema via PGlite; the
 * model is a stub that returns a fixed tool call.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const create = vi.fn();
vi.mock("./anthropic", () => ({
  CRITIC_MODEL: "test-model",
  getAnthropic: () => ({ messages: { create } }),
  toolInput: (res: { content: { type: string; input?: unknown }[] }) =>
    res.content.find((b) => b.type === "tool_use")?.input ?? null,
}));

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const { extractCallInsights } = await import("./extract");

const ORG = "00000000-0000-4000-8000-000000000001";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let n = 0;

async function call(transcript = "Agent: Hi\nUser: Do you do tankless heaters?\nAgent: I'll have someone follow up.") {
  n += 1;
  const id = `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await pg.query(`INSERT INTO calls (id, client_id, start_at, transcript) VALUES ($1, $2, now(), $3)`, [id, A, transcript]);
  return id;
}

function modelReturns(input: Record<string, unknown>) {
  create.mockResolvedValueOnce({
    content: [
      {
        type: "tool_use",
        input: {
          intent: "question",
          entities: { name: "", phone: "", service: "", requestedDate: "", budget: "" },
          isSpam: false,
          followUpDraft: "",
          ...input,
        },
      },
    ],
  });
}

const gaps = async () =>
  (await pg.query<{ call_id: string; questions: string[] }>(`SELECT call_id, questions FROM call_knowledge_gaps ORDER BY created_at`)).rows;

beforeEach(async () => {
  await pg.exec(
    `DELETE FROM call_knowledge_gaps; DELETE FROM call_insights; DELETE FROM calls; DELETE FROM clients; DELETE FROM organizations;`,
  );
  await pg.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Agency')`, [ORG]);
  await pg.query(`INSERT INTO clients (id, org_id, name) VALUES ($1, $2, 'Joe''s Plumbing')`, [A, ORG]);
  create.mockReset();
});

describe("extractCallInsights → knowledge gaps", () => {
  it("records the unanswered questions from the one extraction call", async () => {
    const c = await call();
    modelReturns({ unansweredQuestions: ["Do you service tankless water heaters?"] });
    await extractCallInsights(c);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await gaps()).toEqual([{ call_id: c, questions: ["Do you service tankless water heaters?"] }]);
    // The tool asks for the field, so the model has to answer it.
    const tool = create.mock.calls[0][0].tools[0];
    expect(tool.input_schema.required).toContain("unansweredQuestions");
  });

  it("records an empty list for a call where nothing was missed (it still counts as checked)", async () => {
    const c = await call("Agent: Hi\nUser: What are your hours?\nAgent: 8 to 5.");
    modelReturns({ unansweredQuestions: [] });
    await extractCallInsights(c);
    expect(await gaps()).toEqual([{ call_id: c, questions: [] }]);
  });

  it("treats a missing field as nothing missed rather than failing the extraction", async () => {
    const c = await call();
    modelReturns({});
    await extractCallInsights(c);
    expect(await gaps()).toEqual([{ call_id: c, questions: [] }]);
    const insights = await pg.query(`SELECT 1 FROM call_insights`);
    expect(insights.rows).toHaveLength(1);
  });

  it("doesn't count spam either way", async () => {
    const c = await call("Agent: Hi\nUser: This is an offer for SEO services.");
    modelReturns({ isSpam: true, intent: "spam", unansweredQuestions: ["Do you want SEO services?"] });
    await extractCallInsights(c);
    expect(await gaps()).toEqual([]);
  });

  it("shows the model earlier wording so the same question groups across calls", async () => {
    const first = await call();
    modelReturns({ unansweredQuestions: ["Do you service tankless water heaters?"] });
    await extractCallInsights(first);
    const second = await call();
    modelReturns({ unansweredQuestions: ["Do you service tankless water heaters?"] });
    await extractCallInsights(second);
    const prompt = create.mock.calls[1][0].messages[0].content as string;
    expect(prompt).toContain("- Do you service tankless water heaters?");
  });
});
