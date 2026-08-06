"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, organizations, users } from "@/db/schema";
import {
  requireClientEditor,
  requireOperator,
} from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { syncAgentPrompt } from "@/lib/agent-publish";
import { notifier } from "@/lib/notifier";
import { env } from "@/lib/env";
import { TRIAL_DAYS } from "@/config/plans";
import { logger } from "@/lib/logger";
import { clearAttempts, consumeAttempt, formatRetryAfter } from "@/lib/rate-limit";
import { type ActionState } from "./types";

/**
 * Operator-controlled free trials (full product, no payment):
 *
 *   1. The operator holds an access code (dashboard → Free trials card).
 *   2. A business owner enters the code on their "Your AI" page → the client is
 *      marked `trialRequestedAt` and the operator is emailed.
 *   3. The operator approves → status becomes "trial" on the best plan (Scale),
 *      `trialEndsAt` is set, and activation/provisioning unlocks.
 *
 * The code alone never activates anything — approval is always explicit.
 */

/** Readable code with no ambiguous characters (no 0/O/1/I). */
function generateTrialCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `FD-${out}`;
}

/** Portal: a business owner redeems the operator's trial access code. */
export async function requestTrialAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!code) return { ok: false, error: "Enter your trial code." };

  // requireClientEditor answers "may this ROLE edit a client"; an operator
  // passes it for any client anywhere. The org half of the tenancy rule has to
  // be asked separately, and here it wasn't — so this lookup was unscoped.
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.orgId, guard.user.orgId), isNull(clients.deletedAt)),
  });
  if (!client) return { ok: false, error: "Business not found." };

  // Short hand-typed code — throttle so it can't be guessed in a loop.
  const throttleKey = `trialcode:${clientId}:${guard.user.id}`;
  const gate = consumeAttempt(throttleKey);
  if (!gate.ok) {
    logger.warn("trial.request.throttled", { clientId });
    return {
      ok: false,
      error: `Too many incorrect codes. Try again in ${formatRetryAfter(gate.retryAfterSec)}.`,
    };
  }

  // The code you hand to someone you actually know: the full product, free, no
  // expiry, no approval step, no card. Held in an env var rather than the
  // database so it never turns up in a page, an export, or a backup — and so
  // revoking it is one edit in Vercel rather than a migration.
  //
  // Checked FIRST, before any "you're already sorted" shortcut below. Every new
  // signup now starts on a 21-day trial, which means every single person this
  // code is meant for arrives already status = "trial" — and the shortcut used
  // to catch them and answer "You're already active, no code needed." The one
  // code that grants free service forever was unreachable by everybody it was
  // written for.
  const comp = env.COMP_ACCESS_CODE.trim().toUpperCase();
  if (comp && code === comp) {
    clearAttempts(throttleKey);
    await db
      .update(clients)
      .set({
        status: "live",
        trialEndsAt: null,
        trialRequestedAt: null,
        setupFlags: { ...(client.setupFlags ?? {}), comped: true },
      })
      .where(eq(clients.id, clientId));
    logger.info("trial.comped", { clientId });
    revalidatePath("/portal", "layout");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: "You're in — the full product, on us, for as long as you want it. Go and activate it.",
    };
  }

  // Past the comp code, the shortcuts apply again: a business already trialing
  // or paying has nothing to gain from the ordinary trial code.
  if (client.status === "trial" || client.status === "live") {
    return { ok: true, message: "You're already active — no code needed." };
  }
  if (client.trialRequestedAt) {
    return { ok: true, message: "Your trial request is in — you'll get an email once it's approved." };
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, client.orgId),
  });
  const expected = org?.trialAccessCode?.trim().toUpperCase();
  if (!expected || code !== expected) {
    return {
      ok: false,
      error: "That code isn't valid. Double-check it with the person who gave it to you.",
    };
  }
  clearAttempts(throttleKey);

  await db.update(clients).set({ trialRequestedAt: new Date() }).where(eq(clients.id, clientId));

  // Tell the operator(s) there's a request waiting — best-effort.
  try {
    const operators = await db.query.users.findMany({
      where: and(eq(users.orgId, client.orgId), eq(users.role, "operator"), isNull(users.deletedAt)),
    });
    const base = env.APP_URL.replace(/\/$/, "");
    for (const op of operators) {
      if (!op.email?.trim()) continue;
      await notifier.sendEmail({
        to: op.email,
        subject: `Trial request — ${client.name}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2 style="font-size:17px;margin:0 0 8px">🎟️ Trial request</h2><p style="margin:0 0 6px"><strong>${client.name}</strong> entered your trial code and is waiting for approval.</p><p><a href="${base}/dashboard">Approve it on your dashboard →</a></p></div>`,
        text: `${client.name} entered your trial code and is waiting for approval. Approve: ${base}/dashboard`,
      });
    }
  } catch (err) {
    logger.warn("trial.request.notify_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("trial.requested", { clientId });
  revalidatePath("/portal", "layout");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: "Code accepted! Your free trial is waiting for a quick approval — we'll email you the moment it's on.",
  };
}

/** Operator: approve a pending trial — full product on the best plan, no charge. */
export async function approveTrialAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Client not found." };

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  // A "trial" status client gets the full product — nothing is feature-gated
  // behind a paid plan, so this IS the best version.
  await db
    .update(clients)
    .set({ status: "trial", trialEndsAt })
    .where(eq(clients.id, clientId));

  // Let the owner know they're in — best-effort.
  const ownerEmail = client.ownerEmail?.trim();
  if (ownerEmail) {
    try {
      const base = env.APP_URL.replace(/\/$/, "");
      await notifier.sendEmail({
        to: ownerEmail,
        subject: `Your free trial is on — ${client.name}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2 style="font-size:17px;margin:0 0 8px">🎉 You're in</h2><p style="margin:0 0 6px">Your free trial for <strong>${client.name}</strong> is approved — the full product, every feature unlocked, nothing to pay.</p><p style="margin:0 0 6px">Head to your portal and hit <strong>Activate</strong> on the Your AI page to bring your receptionist live.</p><p><a href="${base}/portal">Open your portal →</a></p></div>`,
        text: `Your free trial for ${client.name} is approved — full product, nothing to pay. Open your portal and hit Activate on the Your AI page: ${base}/portal`,
      });
    } catch (err) {
      logger.warn("trial.approve.notify_failed", {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("trial.approved", { clientId, trialEndsAt: trialEndsAt.toISOString() });
  revalidatePath("/dashboard");
  revalidatePath("/portal", "layout");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: `${client.name} is on a free trial until ${trialEndsAt.toLocaleDateString()}.` };
}

/** Operator: decline a pending request (the owner can re-enter a code later). */
export async function declineTrialAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  await assertClientInOrg(user.orgId, clientId);
  await db.update(clients).set({ trialRequestedAt: null }).where(eq(clients.id, clientId));
  revalidatePath("/dashboard");
  revalidatePath("/portal", "layout");
  return { ok: true, message: "Request declined." };
}

/** Operator: end a running trial — pauses the receptionist immediately. */
/**
 * Put a business on the house, from your side of the desk.
 *
 * The comp code covers someone you want to hand something to before they sign
 * up. This covers the other half — they're already in front of you, on a trial,
 * and you've decided. One click, no code to type, no environment variable to
 * have remembered to set.
 */
export async function compClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Client not found." };

  await db
    .update(clients)
    .set({
      status: "live",
      trialEndsAt: null,
      trialRequestedAt: null,
      setupFlags: { ...(client.setupFlags ?? {}), comped: true },
    })
    .where(eq(clients.id, clientId));

  logger.info("trial.comped.by_operator", { clientId });
  revalidatePath("/dashboard");
  revalidatePath("/portal", "layout");
  return { ok: true, message: `${client.name} is on the house — no clock, no card, no nagging.` };
}

export async function endTrialAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const clientId = String(formData.get("clientId") ?? "");
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Client not found." };
  if (client.status !== "trial") return { ok: false, error: "This client isn't on a trial." };

  await db
    .update(clients)
    .set({ status: "paused", trialEndsAt: new Date(), trialRequestedAt: null })
    .where(eq(clients.id, clientId));
  // Flip the live phone agent to the paused (message-only) behavior right away.
  try {
    await syncAgentPrompt(client.orgId, clientId);
  } catch (err) {
    logger.warn("trial.end.sync_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  logger.info("trial.ended", { clientId });
  revalidatePath("/dashboard");
  revalidatePath("/portal", "layout");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: `${client.name}'s trial has ended — their receptionist is paused.` };
}

/** Operator: set a custom trial access code (e.g. "ARI2026"). */
export async function setTrialCodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const code = String(formData.get("code") ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) {
    return {
      ok: false,
      error: "Codes are 4–24 letters, numbers, or dashes — e.g. ARI2026 or FD-VIP.",
    };
  }
  await db.update(organizations).set({ trialAccessCode: code }).where(eq(organizations.id, user.orgId));
  revalidatePath("/dashboard");
  return { ok: true, message: `Trial code set: ${code}` };
}

/** Operator: create or rotate the trial access code. */
export async function regenerateTrialCodeAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const code = generateTrialCode();
  await db.update(organizations).set({ trialAccessCode: code }).where(eq(organizations.id, user.orgId));
  revalidatePath("/dashboard");
  return { ok: true, message: `New trial code: ${code}` };
}
