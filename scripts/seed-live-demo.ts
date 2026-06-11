/**
 * Populate the live (deployed) database with demo clients so the operator
 * dashboard looks like a working book of business. Creates two clients —
 * "Bright Smile Dental" and "Fade Factory" — each with services, hours, FAQ,
 * and a month of realistic calls / appointments / leads. NO Retell provisioning
 * (purely data), so it's safe to run against production.
 *
 * Attaches everything to the FIRST organization (your account). Idempotent:
 * re-running upserts the clients by name and replaces their demo-tagged rows.
 *
 * Run against Neon (not your local DB):
 *   DATABASE_URL="<neon connection string>" npx tsx scripts/seed-live-demo.ts
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, prepare: false });

function at(daysAgo: number, hour: number, min = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min, 0, 0);
  return d;
}

type ApptStatus = "booked" | "confirmed" | "cancelled" | "no_show";
type Spec = {
  daysAgo: number;
  hour: number;
  min?: number;
  durSec: number;
  from: string;
  outcome: "booked" | "lead" | "faq_answered" | "escalated" | "missed";
  sentiment: "positive" | "neutral" | "negative";
  afterHours?: boolean;
  cost: number;
  transcript: string;
  summary: string;
  appt?: { name: string; inDays: number; hour: number; status: ApptStatus; service: string };
  lead?: { name: string; reason: string; message: string; status: "new" | "contacted" };
};

type Service = { name: string; durationMin: number; priceCents: number; description: string };
type Hour = { day: number; closed: boolean; open?: string; close?: string };
type Faq = { q: string; a: string };
type DemoClient = {
  name: string;
  industry: string;
  address: string;
  timezone: string;
  status: "live" | "trial";
  greeting: string;
  guidance: string;
  booking: string;
  services: Service[];
  hours: Hour[];
  faq: Faq[];
  specs: Spec[];
};

const WEEK_9_5: Hour[] = [
  { day: 0, closed: true },
  { day: 1, closed: false, open: "09:00", close: "17:00" },
  { day: 2, closed: false, open: "09:00", close: "17:00" },
  { day: 3, closed: false, open: "09:00", close: "17:00" },
  { day: 4, closed: false, open: "09:00", close: "17:00" },
  { day: 5, closed: false, open: "09:00", close: "17:00" },
  { day: 6, closed: false, open: "09:00", close: "13:00" },
];

const DENTAL_SPECS: Spec[] = [
  { daysAgo: 11, hour: 10, durSec: 120, from: "+14155550101", outcome: "booked", sentiment: "positive", cost: 16,
    transcript: "Caller: I'd like to come in for a cleaning.\nAgent: Sure — I have an opening, let me book you.", summary: "Booked a routine cleaning.",
    appt: { name: "James Park", inDays: -7, hour: 10, status: "confirmed", service: "Cleaning" } },
  { daysAgo: 12, hour: 13, durSec: 134, from: "+14155550102", outcome: "booked", sentiment: "positive", cost: 17,
    transcript: "Caller: I'm a new patient and need an exam.\nAgent: Welcome! Let's get you in for a new-patient exam.", summary: "New-patient exam booked.",
    appt: { name: "Aisha Khan", inDays: -5, hour: 14, status: "confirmed", service: "Exam" } },
  { daysAgo: 13, hour: 9, durSec: 92, from: "+14155550103", outcome: "booked", sentiment: "neutral", cost: 13,
    transcript: "Caller: Can I book a whitening session?\nAgent: Absolutely — booking your whitening now.", summary: "Whitening booked (caller later no-showed).",
    appt: { name: "Tom Reyes", inDays: -3, hour: 11, status: "no_show", service: "Whitening" } },
  { daysAgo: 2, hour: 19, min: 10, durSec: 110, from: "+14155550104", outcome: "booked", sentiment: "positive", afterHours: true, cost: 15,
    transcript: "Caller: You're closed but I need an exam this week.\nAgent: I can book you first thing — how's 9am?", summary: "After-hours: booked a new-patient exam.",
    appt: { name: "Nina Patel", inDays: 1, hour: 9, status: "booked", service: "Exam" } },
  { daysAgo: 1, hour: 10, durSec: 142, from: "+14155550142", outcome: "booked", sentiment: "positive", cost: 18,
    transcript: "Caller: I'd like to schedule a cleaning.\nAgent: How's Thursday at 2pm?\nCaller: Perfect.\nAgent: Booked!", summary: "Booked a routine cleaning for Thursday 2pm.",
    appt: { name: "Maria Chen", inDays: 2, hour: 14, status: "confirmed", service: "Cleaning" } },
  { daysAgo: 4, hour: 12, durSec: 126, from: "+14155550107", outcome: "booked", sentiment: "positive", cost: 17,
    transcript: "Caller: How much is whitening and can I book it?\nAgent: It's $250 — booking you now.", summary: "Whitening booked.",
    appt: { name: "Sofia Russo", inDays: 4, hour: 16, status: "booked", service: "Whitening" } },
  { daysAgo: 6, hour: 9, durSec: 131, from: "+14155550109", outcome: "booked", sentiment: "neutral", cost: 15,
    transcript: "Caller: New here, need a check-up.\nAgent: Let's book your new-patient exam.", summary: "New-patient exam booked.",
    appt: { name: "Grace Kim", inDays: 8, hour: 13, status: "booked", service: "Exam" } },
  { daysAgo: 8, hour: 11, durSec: 121, from: "+14155550112", outcome: "booked", sentiment: "positive", cost: 16,
    transcript: "Caller: I want whitening before a wedding.\nAgent: Let's get you in — booking now.", summary: "Whitening booked.",
    appt: { name: "Hannah Berg", inDays: 14, hour: 11, status: "booked", service: "Whitening" } },
  { daysAgo: 2, hour: 16, min: 40, durSec: 118, from: "+14155550176", outcome: "lead", sentiment: "neutral", cost: 14,
    transcript: "Caller: Do you do Invisalign? What's the cost?\nAgent: Pricing needs a consult — can I take your details for a callback?",
    summary: "Invisalign pricing lead — wants a callback with a quote.",
    lead: { name: "Priya Nair", reason: "Invisalign pricing", message: "Interested in Invisalign, wants a cost estimate and consult.", status: "new" } },
  { daysAgo: 3, hour: 19, min: 5, durSec: 70, from: "+14155550110", outcome: "faq_answered", sentiment: "positive", afterHours: true, cost: 8,
    transcript: "Caller: Are you open right now? What are your Saturday hours?\nAgent: We're closed now — Mon–Fri 9 to 5, Saturdays 9 to 1.",
    summary: "After-hours caller — answered hours question." },
  { daysAgo: 5, hour: 13, durSec: 54, from: "+14155550133", outcome: "faq_answered", sentiment: "neutral", cost: 7,
    transcript: "Caller: Do you take Delta Dental?\nAgent: Yes, we're in-network with Delta Dental PPO.",
    summary: "Insurance question — confirmed Delta Dental PPO in-network." },
  { daysAgo: 10, hour: 11, durSec: 41, from: "+14155550144", outcome: "missed", sentiment: "neutral", cost: 3,
    transcript: "(Caller hung up before stating their reason.)", summary: "Caller hung up early — no details captured." },
];

const BARBER_SPECS: Spec[] = [
  { daysAgo: 9, hour: 11, durSec: 88, from: "+14155550201", outcome: "booked", sentiment: "positive", cost: 11,
    transcript: "Caller: Can I get a skin fade Saturday?\nAgent: Got a 1pm open — booking you.", summary: "Skin fade booked.",
    appt: { name: "Marcus Lee", inDays: 2, hour: 13, status: "confirmed", service: "Skin Fade" } },
  { daysAgo: 7, hour: 14, durSec: 76, from: "+14155550202", outcome: "booked", sentiment: "positive", cost: 10,
    transcript: "Caller: Haircut and beard trim?\nAgent: Sure — let's get you in Thursday.", summary: "Haircut + beard trim booked.",
    appt: { name: "Dev Shah", inDays: 3, hour: 15, status: "booked", service: "Haircut" } },
  { daysAgo: 4, hour: 18, min: 30, durSec: 64, from: "+14155550203", outcome: "booked", sentiment: "positive", afterHours: true, cost: 9,
    transcript: "Caller: You closed? Need a cut before a trip.\nAgent: I can book you first thing tomorrow.", summary: "After-hours: booked a haircut.",
    appt: { name: "Tyler Brooks", inDays: 1, hour: 10, status: "booked", service: "Haircut" } },
  { daysAgo: 3, hour: 12, durSec: 59, from: "+14155550204", outcome: "lead", sentiment: "neutral", cost: 7,
    transcript: "Caller: Do you do hot towel shaves? Which barber's best?\nAgent: We do — let me take your name and we'll confirm a barber.",
    summary: "Hot-towel-shave lead — wants a specific barber.",
    lead: { name: "Andre Cole", reason: "Hot towel shave", message: "Wants a hot towel shave with a senior barber this weekend.", status: "new" } },
  { daysAgo: 6, hour: 15, durSec: 38, from: "+14155550205", outcome: "faq_answered", sentiment: "positive", cost: 5,
    transcript: "Caller: Do you take walk-ins?\nAgent: We do when there's an open chair, but an appointment skips the wait.",
    summary: "Walk-in question answered." },
  { daysAgo: 1, hour: 13, durSec: 71, from: "+14155550206", outcome: "booked", sentiment: "positive", cost: 9,
    transcript: "Caller: Kids' cut for my son this week?\nAgent: Of course — how's Friday at 4?", summary: "Kids' cut booked.",
    appt: { name: "Rosa Diaz", inDays: 4, hour: 16, status: "booked", service: "Kids" } },
];

const CLIENTS: DemoClient[] = [
  {
    name: "Bright Smile Dental",
    industry: "Dental",
    address: "120 Market St",
    timezone: "America/New_York",
    status: "live",
    greeting: "Hi, thanks for calling Bright Smile Dental! This is Riley. How can I help you today?",
    guidance:
      "Warm, family-run dental practice accepting new patients — mention that when it fits. Never quote exact prices; say it depends on insurance and offer a consult. No clinical advice; offer to book a visit.",
    booking:
      "Book Cleanings and New-Patient Exams. For anything else, take a message. Confirm date, time, and the spelling of the caller's name. Closed Sundays.",
    services: [
      { name: "Cleaning", durationMin: 30, priceCents: 12000, description: "Routine hygiene cleaning." },
      { name: "New-Patient Exam", durationMin: 45, priceCents: 9000, description: "First-visit exam and x-rays." },
      { name: "Whitening", durationMin: 60, priceCents: 25000, description: "In-office teeth whitening." },
    ],
    hours: WEEK_9_5,
    faq: [
      { q: "What insurance do you take?", a: "We're in-network with Delta Dental PPO and accept most major plans." },
      { q: "Are you accepting new patients?", a: "Yes! We'd love to welcome you — new-patient exams are available most weeks." },
      { q: "What are your hours?", a: "Monday to Friday 9 to 5, and Saturdays 9 to 1. Closed Sundays." },
    ],
    specs: DENTAL_SPECS,
  },
  {
    name: "Fade Factory",
    industry: "Barbershop",
    address: "88 Grand Ave",
    timezone: "America/Los_Angeles",
    status: "trial",
    greeting: "Thanks for calling Fade Factory! This is Riley — want to book a cut, or got a question?",
    guidance:
      "Friendly, casual neighborhood barbershop. Always offer to book. Don't promise a specific barber unless booking them. Never quote prices beyond what's listed.",
    booking:
      "Book haircuts, skin fades, beard trims, hot towel shaves, and kids' cuts. Confirm service, day/time, and name. Closed Sundays and Mondays.",
    services: [
      { name: "Haircut", durationMin: 30, priceCents: 3500, description: "Classic cut and style." },
      { name: "Skin Fade", durationMin: 45, priceCents: 4500, description: "Precision skin fade." },
      { name: "Beard Trim", durationMin: 20, priceCents: 2000, description: "Line-up and beard shape." },
      { name: "Kids", durationMin: 30, priceCents: 2500, description: "Kids' cut (12 and under)." },
    ],
    hours: [
      { day: 0, closed: true },
      { day: 1, closed: true },
      { day: 2, closed: false, open: "10:00", close: "19:00" },
      { day: 3, closed: false, open: "10:00", close: "19:00" },
      { day: 4, closed: false, open: "10:00", close: "19:00" },
      { day: 5, closed: false, open: "10:00", close: "20:00" },
      { day: 6, closed: false, open: "09:00", close: "18:00" },
    ],
    faq: [
      { q: "Do you take walk-ins?", a: "We do when a chair's open, but an appointment skips the wait." },
      { q: "What are your hours?", a: "Tuesday to Saturday — closed Sundays and Mondays." },
    ],
    specs: BARBER_SPECS,
  },
];

async function seedClient(orgId: string, def: DemoClient): Promise<void> {
  // Upsert the client by (org, name).
  const existing = await sql<{ id: string }[]>`
    select id from clients where org_id=${orgId} and name=${def.name} and deleted_at is null limit 1`;
  let clientId: string;
  if (existing[0]) {
    clientId = existing[0].id;
    await sql`update clients set industry=${def.industry}, address=${def.address}, timezone=${def.timezone},
      status=${def.status}::client_status, greeting=${def.greeting}, agent_guidance=${def.guidance},
      booking_instructions=${def.booking} where id=${clientId}`;
    // Replace child config so re-runs stay clean.
    await sql`delete from services where client_id=${clientId}`;
    await sql`delete from business_hours where client_id=${clientId}`;
    await sql`delete from knowledge_items where client_id=${clientId}`;
  } else {
    const [row] = await sql<{ id: string }[]>`
      insert into clients (org_id, name, industry, address, timezone, status, greeting, agent_guidance, booking_instructions)
      values (${orgId}, ${def.name}, ${def.industry}, ${def.address}, ${def.timezone}, ${def.status}::client_status,
        ${def.greeting}, ${def.guidance}, ${def.booking})
      returning id`;
    clientId = row.id;
  }

  for (const s of def.services) {
    await sql`insert into services (client_id, name, duration_min, price_cents, description, is_active)
      values (${clientId}, ${s.name}, ${s.durationMin}, ${s.priceCents}, ${s.description}, true)`;
  }
  for (const h of def.hours) {
    await sql`insert into business_hours (client_id, day_of_week, is_closed, open_time, close_time)
      values (${clientId}, ${h.day}, ${h.closed}, ${h.open ?? null}, ${h.close ?? null})`;
  }
  for (const f of def.faq) {
    await sql`insert into knowledge_items (client_id, question, answer, source, is_active)
      values (${clientId}, ${f.q}, ${f.a}, 'manual', true)`;
  }

  const services = await sql<{ id: string; name: string; duration_min: number }[]>`
    select id, name, duration_min from services where client_id=${clientId} and deleted_at is null order by created_at`;
  const fallback = services[0] ?? null;
  const pick = (name: string) =>
    services.find((s) => s.name.toLowerCase().includes(name.toLowerCase())) ?? fallback;

  // Clear demo-tagged activity, then reseed.
  await sql`delete from appointments where client_id=${clientId} and external_booking_id like 'demo_%'`;
  await sql`delete from leads where client_id=${clientId}`;
  await sql`delete from calls where client_id=${clientId} and retell_call_id like 'demo_%'`;

  let i = 0;
  for (const c of def.specs) {
    const start = at(c.daysAgo, c.hour, c.min ?? 0);
    const end = new Date(start.getTime() + c.durSec * 1000);
    const [row] = await sql<{ id: string }[]>`
      insert into calls
        (client_id, retell_call_id, direction, from_number, to_number, start_at, end_at,
         duration_sec, transcript, summary, sentiment, outcome, is_after_hours, retell_cost_cents)
      values
        (${clientId}, ${"demo_" + def.name.slice(0, 3) + (1000 + i)}, 'inbound', ${c.from}, '+14155551234',
         ${start}, ${end}, ${c.durSec}, ${c.transcript}, ${c.summary}, ${c.sentiment}::call_sentiment,
         ${c.outcome}::call_outcome, ${c.afterHours ?? false}, ${c.cost})
      returning id`;

    if (c.appt) {
      const svc = pick(c.appt.service);
      const aStart = at(-c.appt.inDays, c.appt.hour);
      const aEnd = new Date(aStart.getTime() + (svc?.duration_min ?? 30) * 60000);
      await sql`insert into appointments
        (client_id, call_id, customer_name, customer_phone, service_id, start_at, end_at, status, external_booking_id)
        values (${clientId}, ${row.id}, ${c.appt.name}, ${c.from}, ${svc?.id ?? null}, ${aStart}, ${aEnd},
          ${c.appt.status}::appointment_status, ${"demo_cal_" + def.name.slice(0, 3) + (1000 + i)})`;
    }
    if (c.lead) {
      await sql`insert into leads (client_id, call_id, name, phone, reason, message, status)
        values (${clientId}, ${row.id}, ${c.lead.name}, ${c.from}, ${c.lead.reason}, ${c.lead.message}, ${c.lead.status}::lead_status)`;
    }
    i++;
  }

  const [counts] = await sql<{ calls: number; appts: number; leads: number }[]>`
    select
      (select count(*) from calls where client_id=${clientId}) as calls,
      (select count(*) from appointments where client_id=${clientId}) as appts,
      (select count(*) from leads where client_id=${clientId}) as leads`;
  console.log(`  ✓ ${def.name}:`, counts);
}

async function main(): Promise<void> {
  const [org] = await sql<{ id: string }[]>`select id from organizations order by created_at limit 1`;
  if (!org) throw new Error("No organization found — sign in to the deployed app once to bootstrap it.");
  console.log("Seeding demo clients into org", org.id);
  for (const def of CLIENTS) {
    await seedClient(org.id, def);
  }
  await sql.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
