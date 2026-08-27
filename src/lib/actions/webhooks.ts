"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { logger } from "@/lib/logger";
import {
  deliver,
  generateWebhookSecret,
  isDeliverableUrl,
  type WebhookPayload,
} from "@/lib/webhooks-out";
import { type ActionState } from "./types";

/**
 * Save (or clear) where a business wants its events sent.
 *
 * The secret is generated here and never accepted from the form. A signing
 * secret the customer can choose is a signing secret somebody sets to
 * "password", and there is no reason they'd need to pick it — they copy it out
 * of the settings page into whatever is receiving.
 */
export async function saveWebhookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const url = String(formData.get("webhookUrl") ?? "").trim();

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change integrations." };
  }
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Business not found." };
  const flags = { ...(client.setupFlags ?? {}) } as Record<string, unknown>;

  if (!url) {
    delete flags.webhookUrl;
    delete flags.webhookSecret;
    await db.update(clients).set({ setupFlags: flags }).where(eq(clients.id, clientId));
    void audit({ clientId, actor: user.id, action: "webhook.cleared", detail: {} });
    revalidatePath("/portal/settings");
    return { ok: true, message: "Webhook turned off. Nothing more will be sent." };
  }

  if (!isDeliverableUrl(url)) {
    return {
      ok: false,
      fieldErrors: {
        webhookUrl: [
          "Needs to be an https:// address on the public internet — not http, and not a local or private network address.",
        ],
      },
    };
  }

  // Keep an existing secret across a URL edit: rotating it silently would break
  // whatever is already verifying signatures, for no reason the owner asked for.
  const secret = (flags.webhookSecret as string | undefined) ?? generateWebhookSecret();
  flags.webhookUrl = url;
  flags.webhookSecret = secret;
  await db.update(clients).set({ setupFlags: flags }).where(eq(clients.id, clientId));

  logger.info("webhook.saved", { clientId });
  void audit({ clientId, actor: user.id, action: "webhook.saved", detail: { url } });
  revalidatePath("/portal/settings");
  return { ok: true, message: "Saved. Send a test event to check the other end is listening." };
}

/** New signing secret, for when the old one has been somewhere it shouldn't. */
export async function rotateWebhookSecretAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change integrations." };
  }
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Business not found." };
  const flags = { ...(client.setupFlags ?? {}) } as Record<string, unknown>;
  if (!flags.webhookUrl) return { ok: false, error: "Set a webhook URL first." };

  flags.webhookSecret = generateWebhookSecret();
  await db.update(clients).set({ setupFlags: flags }).where(eq(clients.id, clientId));
  void audit({ clientId, actor: user.id, action: "webhook.rotated", detail: {} });
  revalidatePath("/portal/settings");
  return {
    ok: true,
    message: "New signing secret. Update it wherever you're verifying, or deliveries will fail.",
  };
}

/**
 * Send a real, signed delivery so the owner finds out now rather than the first
 * time a customer calls. Reports the receiving end's actual status code — "it
 * didn't work" is useless when the answer is a 401 on their side.
 */
export async function sendTestWebhookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Business not found." };
  const flags = (client.setupFlags ?? {}) as { webhookUrl?: string; webhookSecret?: string };
  if (!flags.webhookUrl || !flags.webhookSecret) {
    return { ok: false, error: "Save a webhook URL first." };
  }

  const payload: WebhookPayload = {
    id: "evt_test",
    event: "lead.created",
    createdAt: new Date().toISOString(),
    clientId,
    data: {
      test: true,
      name: "Test Caller",
      phone: "+14155550148",
      reason: "This is a test event from FrontDesk AI.",
    },
  };
  const result = await deliver({ url: flags.webhookUrl, secret: flags.webhookSecret }, payload);
  return result.ok
    ? { ok: true, message: `Delivered — your endpoint answered ${result.status}.` }
    : {
        ok: false,
        error: `Not delivered after ${result.attempts} ${result.attempts === 1 ? "try" : "tries"}: ${result.error ?? "unknown error"}.`,
      };
}
