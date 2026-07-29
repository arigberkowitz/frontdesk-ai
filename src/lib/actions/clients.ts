"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import { attachCreatorToClient, requireBusinessCreator, requireOperator } from "@/lib/auth-guard";
import { clientCreateSchema, clientProfileSchema, emptyToNull } from "@/lib/validation";
import * as clientsData from "@/lib/data/clients";
import { seedClientFromPack } from "@/lib/starter-seed";
import { safeIndustry } from "@/config/starter-packs";
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

/**
 * One-click starter for a new company: create their first business pre-filled
 * from its industry's starter pack (services, hours, FAQ, guardrails — see
 * `src/config/starter-packs.ts`), then drop them into it to swap in their
 * real details.
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
  const industry = safeIndustry(formData.get("industry"));
  const client = await clientsData.createClient(user.orgId, {
    name,
    websiteUrl: null,
    industry,
    address: null,
    timezone,
    companySize,
    // Teams start with per-person booking ready to go.
    staffModeEnabled: companySize !== "solo",
  });
  await attachCreatorToClient(user, client.id);
  await seedClientFromPack(user.orgId, client.id, industry);

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
