"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import { attachCreatorToClient, requireBusinessCreator, requireOperator } from "@/lib/auth-guard";
import { clientCreateSchema, clientProfileSchema, emptyToNull } from "@/lib/validation";
import * as clientsData from "@/lib/data/clients";
import * as servicesData from "@/lib/data/services";
import * as knowledgeData from "@/lib/data/knowledge";
import * as hoursData from "@/lib/data/hours";
import { env } from "@/lib/env";
import type { ClientStatus } from "@/db/schema";
import { type ActionState, fieldErrorsOf } from "./types";

export async function createClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const parsed = clientCreateSchema.safeParse({
    name: formData.get("name"),
    websiteUrl: formData.get("websiteUrl"),
    industry: formData.get("industry"),
    address: formData.get("address"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const d = parsed.data;
  const client = await clientsData.createClient(user.orgId, {
    name: d.name,
    websiteUrl: emptyToNull(d.websiteUrl),
    industry: emptyToNull(d.industry),
    address: emptyToNull(d.address),
    timezone: d.timezone,
  });
  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

/** Example content a new company edits to match their own business. */
const STARTER_SERVICES = [
  { name: "Consultation", durationMin: 30, priceCents: 0, description: "A free intro call to understand what the customer needs." },
  { name: "Standard appointment", durationMin: 60, priceCents: 12000, description: "Your most common service." },
  { name: "Follow-up visit", durationMin: 30, priceCents: 8000, description: "A shorter check-in for returning customers." },
];
const STARTER_FAQ = [
  { question: "What are your hours?", answer: "We're open Monday to Friday, 9am to 5pm." },
  { question: "Do I need an appointment, or do you take walk-ins?", answer: "Appointments are best, but we take walk-ins whenever we have availability." },
  { question: "How do I reschedule or cancel?", answer: "Just let us know at least 24 hours ahead and we'll happily move your appointment." },
];
const STARTER_GUARDRAILS =
  "Always be warm, polite, and professional. Only answer using the information in this profile — if " +
  "you're not sure about a price, availability, or a policy, offer to take a message and have someone " +
  "follow up. Never make up details, and never give medical, legal, or financial advice.";
const STARTER_BOOKING =
  "Offer the next available openings during business hours. Before booking, confirm the service, the " +
  "date and time, and the caller's name and phone number, then read the appointment back to them.";

/**
 * One-click starter for a new company: create their first business pre-filled with
 * editable example services, hours, FAQ, and guardrails, then drop them into it to
 * swap in their real details.
 */
export async function createStarterClientAction(formData: FormData): Promise<void> {
  const user = await requireBusinessCreator();
  // Keep the name they gave at signup — losing it and making them retype it in
  // Settings was a real usability bug.
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || "Your business";
  const tz = String(formData.get("timezone") ?? "").trim();
  let timezone = "America/New_York";
  try {
    if (tz) {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      timezone = tz;
    }
  } catch {
    /* keep default */
  }
  const sizeRaw = String(formData.get("companySize") ?? "solo");
  const companySize = ["solo", "team", "big"].includes(sizeRaw) ? sizeRaw : "solo";
  const client = await clientsData.createClient(user.orgId, {
    name,
    websiteUrl: null,
    industry: null,
    address: null,
    timezone,
    companySize,
    // Teams start with per-person booking ready to go.
    staffModeEnabled: companySize !== "solo",
  });
  await attachCreatorToClient(user, client.id);

  await Promise.all([
    ...STARTER_SERVICES.map((s) => servicesData.createService(client.id, { ...s, isActive: true })),
    ...STARTER_FAQ.map((f) =>
      knowledgeData.createKnowledge(client.id, { ...f, source: "manual", isActive: true }),
    ),
    hoursData.setWeekHours(
      client.id,
      [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        isClosed: dayOfWeek === 0 || dayOfWeek === 6,
        openTime: "09:00",
        closeTime: "17:00",
      })),
    ),
    clientsData.updateClient(user.orgId, client.id, {
      agentGuidance: STARTER_GUARDRAILS,
      bookingInstructions: STARTER_BOOKING,
    }),
  ]);

  revalidatePath("/portal");
  redirect("/portal");
}

export async function updateClientProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = clientProfileSchema.safeParse({
    name: formData.get("name"),
    websiteUrl: formData.get("websiteUrl"),
    industry: formData.get("industry"),
    address: formData.get("address"),
    timezone: formData.get("timezone"),
    escalationNumber: formData.get("escalationNumber"),
    forwardingNumber: formData.get("forwardingNumber"),
    ownerEmail: formData.get("ownerEmail"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await clientsData.assertClientInOrg(user.orgId, clientId);
  const d = parsed.data;
  await clientsData.updateClient(user.orgId, clientId, {
    name: d.name,
    websiteUrl: emptyToNull(d.websiteUrl),
    industry: emptyToNull(d.industry),
    address: emptyToNull(d.address),
    timezone: d.timezone,
    escalationNumber: emptyToNull(d.escalationNumber),
    forwardingNumber: emptyToNull(d.forwardingNumber),
    ownerEmail: emptyToNull(d.ownerEmail),
  });
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

const STATUS_VALUES: ClientStatus[] = ["draft", "trial", "live", "paused", "churned"];

export async function setClientStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  const status = String(formData.get("status") ?? "") as ClientStatus;
  if (!STATUS_VALUES.includes(status)) return { ok: false, error: "Invalid status." };

  const client = await clientsData.assertClientInOrg(user.orgId, clientId);

  // §A3 guard: can't go live without a provisioned agent + phone number.
  if (
    (status === "live" || status === "trial") &&
    (!client.retellAgentId || !client.retellPhoneNumber)
  ) {
    return {
      ok: false,
      error: "Provision the AI agent and phone number before going live.",
    };
  }

  // Don't let a client go live with no way to notify the owner — otherwise every
  // booking and message is captured silently and the pilot quietly fails.
  if ((status === "live" || status === "trial") && !client.ownerEmail && !client.escalationNumber) {
    return {
      ok: false,
      error:
        "Add an alert email or phone in this client's Settings first, so the owner is notified of every booking and message.",
    };
  }

  await clientsData.setClientStatus(user.orgId, clientId, status);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
  return { ok: true };
}

const inviteSchema = z.object({ email: z.string().trim().email("Enter a valid email") });

/** Invite a read-only client viewer (§G1) via a Clerk invitation carrying role + clientId. */
export async function inviteClientViewerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  const parsed = inviteSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await clientsData.assertClientInOrg(user.orgId, clientId);

  if (!process.env.CLERK_SECRET_KEY) {
    return {
      ok: false,
      error: "Add CLERK_SECRET_KEY to send portal invites (keyless dev mode can't send invitations).",
    };
  }

  try {
    const clerk = await clerkClient();
    await clerk.invitations.createInvitation({
      emailAddress: parsed.data.email,
      publicMetadata: { role: "client_viewer", clientId },
      redirectUrl: `${env.APP_URL}/portal`,
      ignoreExisting: true,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invite failed." };
  }
}

export async function deleteClientAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  await clientsData.assertClientInOrg(user.orgId, clientId);
  await clientsData.softDeleteClient(user.orgId, clientId);
  revalidatePath("/clients");
  redirect("/clients");
}
