/**
 * Seed a second demo client — a barbershop ("Fade Factory") — to show the platform
 * works across trades. Creates the client + services/hours/FAQ/greeting/guardrails,
 * provisions a web-call-able Retell agent (LLM + agent, no phone number), and seeds
 * a few demo calls/appointments/leads. Idempotent: re-running re-seeds in place and
 * reuses the existing Retell agent (no duplicates).
 *   npx tsx scripts/seed-barbershop.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
import Retell from "retell-sdk";

config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

const NAME = "Fade Factory";
const INDUSTRY = "Barbershop";
const ADDRESS = "88 Grand Ave";
const TZ = "America/Los_Angeles";
const GREETING = "Thanks for calling Fade Factory! This is Riley — want to book a cut, or got a question?";
const GUIDANCE = `Keep it friendly and casual — this is a neighborhood barbershop, not a clinic.
Always offer to book an appointment.
If someone asks for a specific barber, take their name and preferred time and say we'll confirm — don't promise a specific barber unless you're booking them.
Never quote prices beyond what's listed in services.`;
const BOOKING = `Book haircuts, skin fades, beard trims, hot towel shaves, and kids' cuts.
Always confirm the service, the day and time, and the customer's name.
If they're unsure, mention walk-ins are welcome but an appointment skips the wait.
We're closed Sundays and Mondays — never offer those.`;

const SERVICES = [
  { name: "Haircut", dur: 30, cents: 3500, desc: "Classic cut, wash, and style" },
  { name: "Skin Fade", dur: 40, cents: 4500, desc: "Precision fade, any length" },
  { name: "Beard Trim", dur: 20, cents: 2000, desc: "Shape-up and line" },
  { name: "Hot Towel Shave", dur: 30, cents: 4000, desc: "Straight-razor shave with hot towel" },
  { name: "Kids Cut (12 & under)", dur: 20, cents: 2500, desc: null },
];

// 0=Sun … 6=Sat. Closed Sun & Mon; Tue–Fri 10–7; Sat 9–5.
const HOURS = [
  { d: 0, closed: true, open: null, close: null },
  { d: 1, closed: true, open: null, close: null },
  { d: 2, closed: false, open: "10:00", close: "19:00" },
  { d: 3, closed: false, open: "10:00", close: "19:00" },
  { d: 4, closed: false, open: "10:00", close: "19:00" },
  { d: 5, closed: false, open: "10:00", close: "19:00" },
  { d: 6, closed: false, open: "09:00", close: "17:00" },
];

const KNOWLEDGE = [
  { q: "Do you take walk-ins?", a: "Walk-ins are welcome, but it gets busy on weekends — I can lock in an appointment so you don't wait." },
  { q: "How much is a haircut?", a: "A standard haircut is $35, and a skin fade is $45." },
  { q: "Do you do beard trims?", a: "We do — a beard trim and line-up is $20, or add it onto a haircut." },
  { q: "Do you cut kids' hair?", a: "Yes! Cuts for 12 and under are $25." },
  { q: "Where are you and is there parking?", a: "We're at 88 Grand Ave — street parking out front and a lot around back." },
];

const AGENT_TOOLS_SECRET =
  process.env.AGENT_TOOLS_SECRET || process.env.RETELL_API_KEY || "dev-agent-tools-secret";

/** Inline copy of the agent tools — retell.ts is "server-only" and can't be imported here. */
function buildTools(appUrl: string, clientId: string) {
  const base = appUrl.replace(/\/$/, "");
  const url = (path: string) =>
    `${base}/api/agent-tools/${path}?client=${clientId}&token=${encodeURIComponent(AGENT_TOOLS_SECRET)}`;
  return [
    { type: "custom", name: "check_availability", url: url("check-availability"), description: "Check open appointment slots for a service over a date range. Call this before booking.", speak_during_execution: true, parameters: { type: "object", properties: { service: { type: "string", description: "The service the caller wants." }, date_range: { type: "string", description: "Natural-language date or range." } }, required: ["service"] } },
    { type: "custom", name: "book_appointment", url: url("book"), description: "Book an appointment after confirming service, date/time, name, and phone.", speak_during_execution: true, parameters: { type: "object", properties: { service: { type: "string" }, datetime: { type: "string", description: "ISO 8601 start date-time." }, name: { type: "string" }, phone: { type: "string" } }, required: ["service", "datetime", "name", "phone"] } },
    { type: "custom", name: "take_message", url: url("message"), description: "Capture a message/lead with name, phone, and reason when booking isn't possible.", parameters: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, reason: { type: "string" }, message: { type: "string" } }, required: ["name", "phone"] } },
    { type: "custom", name: "transfer_to_human", url: url("transfer"), description: "Transfer the call to a human when requested or for sensitive matters.", speak_during_execution: true, parameters: { type: "object", properties: {}, required: [] } },
  ];
}

function at(daysAgo: number, hour: number, min = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min, 0, 0);
  return d;
}

type CallSpec = {
  daysAgo: number;
  hour: number;
  min?: number;
  dur: number;
  from: string;
  outcome: string;
  sentiment: string;
  afterHours?: boolean;
  cost: number;
  transcript: string;
  summary: string;
  appt?: { name: string; inDays: number; hour: number; service: string };
  lead?: { name: string; reason: string; message: string };
};

const CALLS: CallSpec[] = [
  { daysAgo: 1, hour: 11, dur: 96, from: "+14155550311", outcome: "booked", sentiment: "positive", cost: 13,
    transcript: "Caller: Can I get a skin fade Saturday?\nAgent: Sure — how's 11am?\nCaller: Perfect, name's Marcus.\nAgent: Booked, Marcus — see you Saturday at 11.",
    summary: "Booked a skin fade for Saturday 11am.", appt: { name: "Marcus Hill", inDays: 4, hour: 11, service: "Skin Fade" } },
  { daysAgo: 2, hour: 14, dur: 58, from: "+14155550322", outcome: "faq_answered", sentiment: "neutral", cost: 8,
    transcript: "Caller: Do you take walk-ins?\nAgent: We do, but weekends get busy — want me to grab you a slot so you skip the wait?\nCaller: Nah I'll just walk in, thanks.",
    summary: "Walk-in question — offered to book, caller declined." },
  { daysAgo: 3, hour: 17, min: 30, dur: 84, from: "+14155550333", outcome: "booked", sentiment: "positive", cost: 11,
    transcript: "Caller: Need a haircut and beard trim tomorrow afternoon.\nAgent: I can do 4pm — that's a haircut plus a trim.\nCaller: Great, it's Dev.\nAgent: Done, Dev — 4pm tomorrow.",
    summary: "Booked haircut + beard trim for tomorrow 4pm.", appt: { name: "Dev Anand", inDays: 1, hour: 16, service: "Haircut" } },
  { daysAgo: 5, hour: 20, min: 15, dur: 64, from: "+14155550344", outcome: "lead", sentiment: "neutral", afterHours: true, cost: 9,
    transcript: "Caller: Does Tony still work there? I only go to him.\nAgent: We're closed right now — let me take your name and a good time, and we'll confirm Tony's availability.\nCaller: It's Sam, Saturday morning ideally.",
    summary: "After-hours: asked for a specific barber (Tony); took a message to confirm.",
    lead: { name: "Sam Rivera", reason: "Requested barber Tony", message: "Only books with Tony — wants Saturday morning; confirm Tony's availability." } },
];

async function main(): Promise<void> {
  const [org] = await sql<{ id: string }[]>`select id from organizations order by created_at limit 1`;
  if (!org) throw new Error("No organization found — sign in once to bootstrap it.");

  const existing = await sql<{ id: string; retell_llm_id: string | null; retell_agent_id: string | null }[]>`
    select id, retell_llm_id, retell_agent_id from clients
    where org_id=${org.id} and name=${NAME} and deleted_at is null limit 1`;

  let clientId: string;
  let llmId: string | null = null;
  let agentId: string | null = null;

  if (existing[0]) {
    clientId = existing[0].id;
    llmId = existing[0].retell_llm_id;
    agentId = existing[0].retell_agent_id;
    await sql`delete from appointments where client_id=${clientId}`;
    await sql`delete from leads where client_id=${clientId}`;
    await sql`delete from calls where client_id=${clientId}`;
    await sql`delete from services where client_id=${clientId}`;
    await sql`delete from business_hours where client_id=${clientId}`;
    await sql`delete from knowledge_items where client_id=${clientId}`;
    await sql`update clients set industry=${INDUSTRY}, address=${ADDRESS}, timezone=${TZ}, status='live',
      greeting=${GREETING}, agent_guidance=${GUIDANCE}, booking_instructions=${BOOKING} where id=${clientId}`;
  } else {
    const [c] = await sql<{ id: string }[]>`
      insert into clients (org_id, name, industry, address, timezone, status, greeting, agent_guidance, booking_instructions)
      values (${org.id}, ${NAME}, ${INDUSTRY}, ${ADDRESS}, ${TZ}, 'live', ${GREETING}, ${GUIDANCE}, ${BOOKING})
      returning id`;
    clientId = c.id;
  }

  for (const s of SERVICES) {
    await sql`insert into services (client_id, name, duration_min, price_cents, description, is_active)
      values (${clientId}, ${s.name}, ${s.dur}, ${s.cents}, ${s.desc}, true)`;
  }
  for (const h of HOURS) {
    await sql`insert into business_hours (client_id, day_of_week, is_closed, open_time, close_time)
      values (${clientId}, ${h.d}, ${h.closed}, ${h.open}, ${h.close})`;
  }
  for (const k of KNOWLEDGE) {
    await sql`insert into knowledge_items (client_id, question, answer, source, is_active)
      values (${clientId}, ${k.q}, ${k.a}, 'manual', true)`;
  }

  // Provision a web-call-able agent (LLM + agent only — no card-gated phone number).
  if (process.env.RETELL_API_KEY) {
    const { buildGeneralPrompt } = await import("../src/lib/prompt");
    const prompt = buildGeneralPrompt({
      agentName: "Riley",
      client: {
        name: NAME,
        industry: INDUSTRY,
        address: ADDRESS,
        timezone: TZ,
        escalationNumber: null,
        recordingDisclosureEnabled: true,
        recordingDisclosureLine: null,
        guidance: GUIDANCE,
        bookingInstructions: BOOKING,
      },
      services: SERVICES.map((s) => ({
        name: s.name,
        durationMin: s.dur,
        priceCents: s.cents,
        description: s.desc,
        isActive: true,
      })),
      hours: HOURS.map((h) => ({ dayOfWeek: h.d, isClosed: h.closed, openTime: h.open, closeTime: h.close })),
      knowledge: KNOWLEDGE.map((k) => ({ question: k.q, answer: k.a, isActive: true })),
    });
    const tools = buildTools(
      process.env.APP_URL as string,
      clientId,
    ) as Retell.LlmCreateParams["general_tools"];
    const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });
    const llmBody = { general_prompt: prompt, general_tools: tools, begin_message: GREETING };

    if (llmId) await retell.llm.update(llmId, llmBody);
    else llmId = (await retell.llm.create({ model: "gpt-4.1-mini", ...llmBody })).llm_id;

    const agentBody = {
      response_engine: { type: "retell-llm" as const, llm_id: llmId },
      voice_id: "11labs-Adrian",
      agent_name: "Riley",
      webhook_url: `${process.env.APP_URL}/api/webhooks/retell`,
      boosted_keywords: [NAME, ...SERVICES.map((s) => s.name)],
      language: "en-US" as const,
    };
    if (agentId) await retell.agent.update(agentId, agentBody);
    else agentId = (await retell.agent.create(agentBody)).agent_id;

    await sql`update clients set retell_llm_id=${llmId}, retell_agent_id=${agentId} where id=${clientId}`;
  }

  // Demo activity.
  let i = 0;
  const svc = await sql<{ id: string; name: string; duration_min: number }[]>`
    select id, name, duration_min from services where client_id=${clientId} and deleted_at is null`;
  for (const c of CALLS) {
    const start = at(c.daysAgo, c.hour, c.min ?? 0);
    const end = new Date(start.getTime() + c.dur * 1000);
    const [row] = await sql<{ id: string }[]>`
      insert into calls (client_id, retell_call_id, direction, from_number, to_number, start_at, end_at,
        duration_sec, transcript, summary, sentiment, outcome, is_after_hours, retell_cost_cents)
      values (${clientId}, ${"demo_bb_" + (1000 + i)}, 'inbound', ${c.from}, '+14155559876', ${start}, ${end},
        ${c.dur}, ${c.transcript}, ${c.summary}, ${c.sentiment}::call_sentiment, ${c.outcome}::call_outcome,
        ${c.afterHours ?? false}, ${c.cost})
      returning id`;
    if (c.appt) {
      const service = svc.find((s) => s.name === c.appt!.service) ?? svc[0];
      const aStart = at(-c.appt.inDays, c.appt.hour);
      const aEnd = new Date(aStart.getTime() + (service?.duration_min ?? 30) * 60000);
      await sql`insert into appointments (client_id, call_id, customer_name, customer_phone, service_id, start_at, end_at, status, external_booking_id)
        values (${clientId}, ${row.id}, ${c.appt.name}, ${c.from}, ${service?.id ?? null}, ${aStart}, ${aEnd}, 'confirmed'::appointment_status, ${"demo_bb_cal_" + (1000 + i)})`;
    }
    if (c.lead) {
      await sql`insert into leads (client_id, call_id, name, phone, reason, message, status)
        values (${clientId}, ${row.id}, ${c.lead.name}, ${c.from}, ${c.lead.reason}, ${c.lead.message}, 'new'::lead_status)`;
    }
    i++;
  }

  const [counts] = await sql<{ services: number; calls: number; appts: number }[]>`
    select
      (select count(*) from services where client_id=${clientId}) as services,
      (select count(*) from calls where client_id=${clientId}) as calls,
      (select count(*) from appointments where client_id=${clientId}) as appts`;
  console.log(`✓ Seeded ${NAME} (${INDUSTRY}).`, counts, llmId ? `agent ${agentId}` : "(no agent — set RETELL_API_KEY)");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
