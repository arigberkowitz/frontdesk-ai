/**
 * Demo helper: push the first client's greeting to its live Retell agent as the
 * LLM begin_message (the agent's opening line).  npx tsx scripts/publish-greeting.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
import Retell from "retell-sdk";

config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

async function main(): Promise<void> {
  const [c] = await sql<{ name: string; greeting: string | null; retell_llm_id: string | null }[]>`
    select name, greeting, retell_llm_id from clients where deleted_at is null order by created_at limit 1`;
  if (!c) throw new Error("No client found.");
  const greeting =
    c.greeting?.trim() ||
    `Hi, thanks for calling ${c.name}! This is Riley, the AI assistant. How can I help you today?`;

  if (c.retell_llm_id && process.env.RETELL_API_KEY) {
    const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });
    await retell.llm.update(c.retell_llm_id, { begin_message: greeting });
    console.log(`✓ ${c.name} now opens with: "${greeting}"`);
  } else {
    console.log(`Saved greeting for ${c.name}, but no Retell LLM id to publish to.`);
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
