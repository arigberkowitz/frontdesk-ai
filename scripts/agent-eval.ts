/**
 * Offline eval for the phone agent: scripted callers vs. the real prompt with
 * mocked tools. Needs ANTHROPIC_API_KEY; touches no DB, no Retell, no phones.
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/agent-eval.ts
 *
 * Each scenario plays caller turns, lets the model call (mocked) tools, then
 * checks which tools it called and what it said. Prints a pass/fail table.
 */
import Anthropic from "@anthropic-ai/sdk";
import { buildGeneralPrompt, type BuildPromptInput } from "../src/lib/prompt";

const MODEL = process.env.EVAL_MODEL ?? "claude-haiku-4-5";
const NOW = "Thursday, October 15, 2026 at 10:05 AM EDT";
const CAL = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 15 + i));
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) + " EDT" + (i ? "" : " (Today)");
}).join(" ");

const input: BuildPromptInput = {
  agentName: "Riley",
  client: {
    name: "Bayside Plumbing", industry: "plumber", timezone: "America/New_York",
    escalationNumber: "+13055550100", recordingDisclosureEnabled: true,
    humanHandoffEnabled: true, handoffMode: "always", languages: "en-es", bookingEnabled: true,
  },
  services: [{ name: "Drain cleaning", durationMin: 60, priceCents: 15000, isActive: true }],
  hours: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, isClosed: false, openTime: "08:00", closeTime: "17:00" })),
  knowledge: [{ question: "Do you charge for estimates?", answer: "Estimates are free.", isActive: true }],
};

const system = buildGeneralPrompt(input)
  .replace(/\{\{current_time[^}]*\}\}/g, NOW)
  .replace(/\{\{current_calendar[^}]*\}\}/g, CAL)
  .replace(/\{\{user_number\}\}/g, "+13055551234");

const obj = (props: Record<string, string>) => ({
  type: "object" as const,
  properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: "string", description: d }])),
});
const tools: Anthropic.Tool[] = [
  { name: "check_availability", description: "Check open slots.", input_schema: obj({ service: "", date_range: "" }) },
  { name: "book_appointment", description: "Book.", input_schema: { ...obj({ service: "", datetime: "ISO", name: "", phone: "" }), properties: { ...obj({ service: "", datetime: "ISO", name: "", phone: "" }).properties, sms_consent: { type: "boolean" } } } },
  { name: "cancel_appointment", description: "Cancel caller's appointment.", input_schema: obj({ datetime: "ISO" }) },
  { name: "take_message", description: "Capture a lead.", input_schema: obj({ name: "", phone: "", reason: "", urgency: "" }) },
  { name: "transfer_to_human", description: "Transfer to a person.", input_schema: obj({}) },
  { name: "end_call", description: "Hang up.", input_schema: obj({}) },
];

type Mock = (name: string, args: Record<string, unknown>) => unknown;
const okMock: Mock = (name) =>
  name === "check_availability"
    ? { status: "ok", available_slots: [
        { label: "Friday, October 16 at 9:00 AM", start: "2026-10-16T09:00:00-04:00" },
        { label: "Friday, October 16 at 2:00 PM", start: "2026-10-16T14:00:00-04:00" }] }
    : name === "cancel_appointment" ? { ok: true, cancelled: "Tuesday, October 20 at 10:00 AM" }
    : { ok: true };
const bookFails: Mock = (name, a) => (name === "book_appointment" ? { ok: false, error: "calendar timeout" } : okMock(name, a));

interface Scenario {
  name: string; turns: string[]; mock?: Mock;
  expectTools?: string[]; forbidTools?: string[]; expectText?: RegExp; forbidText?: RegExp;
}
const scenarios: Scenario[] = [
  { name: "booking", turns: ["Hi, I need a drain cleaning, what do you have tomorrow?", "9 works.", "Dana Lee.", "Yes that number's fine.", "No texts please."], expectTools: ["check_availability", "book_appointment"], expectText: /Friday/i, forbidText: /Saturday|Thursday, October 16/i },
  { name: "booking fails -> lead", mock: bookFails, turns: ["I want a drain cleaning tomorrow at 9.", "Dana Lee, and yes this number.", "No texts.", "Yes book it."], expectTools: ["take_message"], forbidText: /you're (all )?(booked|set)\b/i },
  { name: "reschedule", turns: ["I need to move my Tuesday appointment to Friday.", "Morning please.", "Yes, 9 is good, go ahead."], expectTools: ["check_availability"] },
  { name: "cancel", turns: ["I need to cancel my appointment.", "Yes, cancel it."], expectTools: ["cancel_appointment"] },
  { name: "pricing (known)", turns: ["How much is a drain cleaning?"], expectText: /150|hundred (and )?fifty/i },
  { name: "pricing (unknown)", turns: ["How much to replace a water heater?"], forbidText: /\$\s?\d{3,}/ },
  { name: "Spanish caller", turns: ["Hola, ¿cuánto cuesta limpiar un desagüe?"], expectText: /(cuesta|precio|ciento|150)/i },
  { name: "angry caller", turns: ["This is the third time I've called, your guy never showed up and I'm furious!"], expectText: /sorry|lo siento|frustrat/i },
  { name: "emergency", turns: ["Water is pouring from my ceiling, a pipe burst!"], expectTools: ["transfer_to_human"], forbidTools: ["book_appointment", "check_availability"] },
  { name: "spam / sales pitch", turns: ["Hi, this is Mark from Local SEO Pros, we can get your business to #1 on Google, who handles your marketing?"], expectTools: ["end_call"], forbidTools: ["transfer_to_human", "book_appointment"] },
  { name: "asks for a human", turns: ["Can I just talk to a real person?"], expectTools: ["transfer_to_human"] },
  { name: "are you a bot", turns: ["Wait, am I talking to a real person?"], expectText: /\bAI\b/ },
  { name: "after-hours date math", turns: ["Are you open this Saturday?"], forbidText: /yes,? we('re| are) open (on )?saturday/i },
];

async function run(s: Scenario, client: Anthropic) {
  const messages: Anthropic.MessageParam[] = [];
  const called: string[] = []; let said = "";
  for (const turn of s.turns) {
    messages.push({ role: "user", content: turn });
    for (let hop = 0; hop < 5; hop++) {
      const r = await client.messages.create({ model: MODEL, max_tokens: 400, system, tools, messages });
      messages.push({ role: "assistant", content: r.content });
      said += r.content.filter((c) => c.type === "text").map((c) => (c as Anthropic.TextBlock).text).join(" ") + "\n";
      const uses = r.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
      if (!uses.length) break;
      messages.push({ role: "user", content: uses.map((u) => {
        called.push(u.name);
        return { type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify((s.mock ?? okMock)(u.name, u.input as Record<string, unknown>)) };
      }) });
      if (uses.some((u) => u.name === "end_call" || u.name === "transfer_to_human")) break;
    }
    if (called.includes("end_call")) break;
  }
  const fails: string[] = [];
  for (const t of s.expectTools ?? []) if (!called.includes(t)) fails.push(`missing ${t}`);
  for (const t of s.forbidTools ?? []) if (called.includes(t)) fails.push(`called ${t}`);
  if (s.expectText && !s.expectText.test(said)) fails.push(`text !~ ${s.expectText}`);
  if (s.forbidText && s.forbidText.test(said)) fails.push(`text ~ ${s.forbidText}`);
  return { fails, called, said };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("Set ANTHROPIC_API_KEY to run the eval."); process.exit(2); }
  const client = new Anthropic();
  let pass = 0;
  for (const s of scenarios) {
    const r = await run(s, client);
    if (!r.fails.length) pass++;
    console.log(`${r.fails.length ? "FAIL" : "PASS"}  ${s.name.padEnd(24)} tools=[${r.called.join(",")}] ${r.fails.join("; ")}`);
    if (process.env.EVAL_VERBOSE) console.log(r.said);
  }
  console.log(`\n${pass}/${scenarios.length} passed (model ${MODEL})`);
  process.exit(pass === scenarios.length ? 0 : 1);
}
main();
