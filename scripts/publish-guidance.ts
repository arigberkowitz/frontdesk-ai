/**
 * Demo helper: set sample company guardrails + booking rules on the first client
 * and push the rebuilt prompt to the live Retell agent so a test call reflects them.
 *   npx tsx scripts/publish-guidance.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
import Retell from "retell-sdk";
import { buildGeneralPrompt } from "../src/lib/prompt";

config({ path: ".env.local" });
const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

const GUIDANCE = `You're the receptionist for a friendly, family-run dental practice that's accepting new patients — mention that warmly when it fits.
Never quote exact prices. Say it depends on their insurance and offer to book a consult.
Don't give clinical or medical advice. If a caller describes symptoms, offer to book a visit.
If someone has severe pain, facial swelling, or a knocked-out tooth, treat it as urgent: offer the soonest opening or to connect them to the office.`;

const BOOKING = `Only book Teeth Cleanings and New-Patient Exams.
For fillings, crowns, whitening, or anything else, take a message and let them know the office will call back to schedule.
Always confirm the date, time, and the spelling of the caller's name, and read the appointment back before confirming.
We're closed Sundays — never offer a Sunday.`;

async function main(): Promise<void> {
  const [client] = await sql<
    {
      id: string;
      name: string;
      industry: string | null;
      address: string | null;
      timezone: string;
      escalation_number: string | null;
      recording_disclosure_enabled: boolean;
      recording_disclosure_line: string | null;
      retell_llm_id: string | null;
    }[]
  >`select id, name, industry, address, timezone, escalation_number,
           recording_disclosure_enabled, recording_disclosure_line, retell_llm_id
    from clients where deleted_at is null order by created_at limit 1`;
  if (!client) throw new Error("No client found.");

  await sql`update clients set agent_guidance=${GUIDANCE}, booking_instructions=${BOOKING} where id=${client.id}`;

  const services = await sql<
    { name: string; duration_min: number; price_cents: number | null; description: string | null; is_active: boolean }[]
  >`select name, duration_min, price_cents, description, is_active from services where client_id=${client.id} and deleted_at is null`;
  const hours = await sql<
    { day_of_week: number; is_closed: boolean; open_time: string | null; close_time: string | null }[]
  >`select day_of_week, is_closed, open_time, close_time from business_hours where client_id=${client.id}`;
  const knowledge = await sql<
    { question: string; answer: string; is_active: boolean }[]
  >`select question, answer, is_active from knowledge_items where client_id=${client.id} and deleted_at is null`;

  const prompt = buildGeneralPrompt({
    agentName: "Riley",
    client: {
      name: client.name,
      industry: client.industry,
      address: client.address,
      timezone: client.timezone,
      escalationNumber: client.escalation_number,
      recordingDisclosureEnabled: client.recording_disclosure_enabled,
      recordingDisclosureLine: client.recording_disclosure_line,
      guidance: GUIDANCE,
      bookingInstructions: BOOKING,
    },
    services: services.map((s) => ({
      name: s.name,
      durationMin: s.duration_min,
      priceCents: s.price_cents,
      description: s.description,
      isActive: s.is_active,
    })),
    hours: hours.map((h) => ({
      dayOfWeek: h.day_of_week,
      isClosed: h.is_closed,
      openTime: h.open_time,
      closeTime: h.close_time,
    })),
    knowledge: knowledge.map((k) => ({ question: k.question, answer: k.answer, isActive: k.is_active })),
  });

  if (client.retell_llm_id && process.env.RETELL_API_KEY) {
    const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });
    await retell.llm.update(client.retell_llm_id, { general_prompt: prompt });
    console.log(`✓ Saved guardrails on ${client.name} and pushed the prompt live (LLM ${client.retell_llm_id}).`);
  } else {
    console.log(`✓ Saved guardrails on ${client.name}. (No Retell LLM id — publish from the Agent tab to push live.)`);
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
