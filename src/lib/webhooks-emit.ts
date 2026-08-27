import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  deliver,
  type OutboundEvent,
  type WebhookConfig,
  type WebhookPayload,
} from "@/lib/webhooks-out";

/**
 * Read a client's webhook config and send one event.
 *
 * Config lives in `setupFlags` rather than its own columns, for the same reason
 * `blockedNumbers` and `handoffMode` do: it is per-client configuration, not
 * business records, and it ships without a migration against a production
 * database that is answering phones right now.
 *
 * Every caller is on a hot path — inside a live call's tool round-trip, or
 * inside a Retell webhook we owe a fast 200 — so nobody awaits this. Callers
 * wrap it in `after()` where the runtime offers it and `void` it otherwise.
 * It swallows everything: a customer's CRM being down is not a reason for a
 * caller to hear silence.
 */
export async function emitWebhook(
  clientId: string,
  event: OutboundEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const row = await db.query.clients.findFirst({
      where: eq(clients.id, clientId),
      columns: { setupFlags: true },
    });
    const flags = row?.setupFlags as { webhookUrl?: string; webhookSecret?: string } | undefined;
    const config: WebhookConfig = { url: flags?.webhookUrl, secret: flags?.webhookSecret };
    if (!config.url || !config.secret) return;

    const payload: WebhookPayload = {
      id: `evt_${randomUUID()}`,
      event,
      createdAt: new Date().toISOString(),
      clientId,
      data,
    };
    const result = await deliver(config, payload);
    if (result.ok) {
      logger.info("webhook.out.delivered", { clientId, event, attempts: result.attempts });
    } else {
      // Loud in the log, silent to the caller. The health-check sweep is the
      // right place to notice a webhook that has been failing for a week; a
      // phone call is not.
      logger.warn("webhook.out.failed", {
        clientId,
        event,
        attempts: result.attempts,
        status: result.status,
        error: result.error,
      });
    }
  } catch (err) {
    logger.error("webhook.out.threw", {
      clientId,
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
