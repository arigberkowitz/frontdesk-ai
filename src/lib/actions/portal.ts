"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users, type NewClient } from "@/db/schema";
import { assertClientAccess, requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe, updateClient } from "@/lib/data/clients";
import { applyClientEdit } from "@/lib/agent-publish";
import { notifier } from "@/lib/notifier";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Save the business's own settings from the portal: display name, timezone, and
 * where booking / message alerts should go (owner email + alert phone). Each
 * card submits only its own fields, so we patch just what was sent.
 */
export async function savePortalProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const patch: Partial<NewClient> = {};

  if (formData.has("name")) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, fieldErrors: { name: ["Business name is required"] } };
    if (name.length > 120) return { ok: false, fieldErrors: { name: ["Keep it under 120 characters"] } };
    patch.name = name;
  }
  if (formData.has("timezone")) {
    const tz = String(formData.get("timezone") ?? "").trim();
    if (tz) patch.timezone = tz;
  }
  if (formData.has("languages")) {
    const lang = String(formData.get("languages") ?? "");
    patch.languages = ["en", "en-es", "es"].includes(lang) ? lang : "en";
  }
  if (formData.has("ownerEmail")) {
    const email = String(formData.get("ownerEmail") ?? "").trim();
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, fieldErrors: { ownerEmail: ["Enter a valid email"] } };
    }
    patch.ownerEmail = email || null;
  }
  if (formData.has("alertPhone")) {
    const phone = String(formData.get("alertPhone") ?? "").trim();
    if (phone.length > 40) return { ok: false, fieldErrors: { alertPhone: ["That doesn't look right"] } };
    // The transfer loop: their forwarded line points at the AI, so transferring
    // a caller there sends the call straight back to the AI and the caller never
    // reaches a person. It's an easy mistake — the forwarded line is the number
    // most people think of as "our phone" — and it fails silently on live calls,
    // so refuse it here rather than let them find out from an angry customer.
    if (phone) {
      const existing = await db.query.clients.findFirst({
        where: (c, { eq: e }) => e(c.id, clientId),
        columns: { forwardingNumber: true },
      });
      const bare = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      const fwd = existing?.forwardingNumber ? bare(existing.forwardingNumber) : "";
      if (fwd && bare(phone) === fwd) {
        return {
          ok: false,
          fieldErrors: {
            alertPhone: [
              "That's the line you forwarded to your AI — transferring a caller there would send them right back to the AI. Use a mobile or a direct line instead.",
            ],
          },
        };
      }
    }
    patch.escalationNumber = phone || null;
  }
  if (formData.has("humanHandoffEnabled")) {
    patch.humanHandoffEnabled = String(formData.get("humanHandoffEnabled")) === "on";
  }
  if (formData.has("humanHoursNote")) {
    const note = String(formData.get("humanHoursNote") ?? "").trim();
    if (note.length > 200) return { ok: false, fieldErrors: { humanHoursNote: ["Keep it under 200 characters"] } };
    patch.humanHoursNote = note || null;
  }
  if (formData.has("outboundRecoveryEnabled")) {
    patch.outboundRecoveryEnabled = String(formData.get("outboundRecoveryEnabled")) === "on";
  }
  if (formData.has("smsAlertsEnabled")) {
    patch.smsAlertsEnabled = String(formData.get("smsAlertsEnabled")) === "on";
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to save." };

  // Renaming the business must not leave a stale name inside the spoken
  // greeting ("thanks for calling Your Business…"). If the saved greeting
  // mentions the old name — or the starter placeholder — rewrite it.
  if (patch.name) {
    const existing = await getClientByIdUnsafe(clientId);
    if (existing?.greeting) {
      let greeting = existing.greeting;
      if (existing.name !== patch.name && greeting.includes(existing.name)) {
        greeting = greeting.replaceAll(existing.name, patch.name);
      }
      if (greeting.includes("Your business")) {
        greeting = greeting.replaceAll("Your business", patch.name);
      }
      if (greeting !== existing.greeting) patch.greeting = greeting;
    }
  }

  await updateClient(user.orgId, clientId, patch);
  // Business name lives in the agent prompt, so keep the live agent in sync.
  await applyClientEdit(user, clientId);
  revalidatePath("/portal/settings");
  return { ok: true };
}

/**
 * Resolve where a portal "contact support" message should land:
 *   1. An explicit SUPPORT_EMAIL inbox, if configured.
 *   2. The workspace operator (agency owner) — the human who manages this client.
 *   3. Platform support (super admin) as a last resort.
 * Never the sender themselves (a self-serve owner shouldn't email their own inbox).
 */
async function resolveSupportRecipient(orgId: string, senderEmail: string): Promise<string | null> {
  const explicit = (process.env.SUPPORT_EMAIL ?? "").trim();
  if (explicit) return explicit;

  const ops = await db.query.users.findMany({
    where: and(eq(users.orgId, orgId), eq(users.role, "operator"), isNull(users.deletedAt)),
    orderBy: (u, { asc }) => [asc(u.createdAt)],
  });
  const other = ops.find((o) => o.email && o.email.toLowerCase() !== senderEmail.toLowerCase());
  if (other?.email) return other.email;

  const fallback = (process.env.SUPER_ADMIN_EMAILS ?? "arigberkowitz@gmail.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return fallback ?? null;
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

/**
 * "Get help" form in the portal: emails the workspace operator / support a
 * question or issue from the business owner, with the sender + business in the body.
 */
export async function contactSupportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);

  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (!message) return { ok: false, fieldErrors: { message: ["Tell us what's going on"] } };
  if (message.length > 4000) return { ok: false, fieldErrors: { message: ["That's a bit long — keep it under 4000 characters"] } };

  const client = await getClientByIdUnsafe(clientId);
  const business = client?.name ?? "a client";
  const to = await resolveSupportRecipient(user.orgId, user.email);
  if (!to) return { ok: false, error: "Support contact isn't set up yet — please try again later." };

  const subjectLine = subject ? `Portal help: ${subject}` : `Portal help from ${business}`;
  const lines = [
    `<strong>From:</strong> ${esc(user.email)}`,
    `<strong>Business:</strong> ${esc(business)}`,
    subject ? `<strong>Subject:</strong> ${esc(subject)}` : "",
    "",
    ...message.split("\n").map((l) => esc(l) || "&nbsp;"),
  ].filter((l) => l !== "");

  const result = await notifier.sendEmail({
    to,
    subject: subjectLine,
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;font-size:15px;line-height:1.5">
  ${lines.map((l) => `<p style="margin:0 0 6px">${l}</p>`).join("\n  ")}
  <p style="color:#999;font-size:12px;margin-top:18px">Sent from the FrontDesk AI client portal · reply to ${esc(user.email)}</p>
</div>`,
    text: `From: ${user.email}\nBusiness: ${business}\n${subject ? `Subject: ${subject}\n` : ""}\n${message}`,
  });

  if (result.skipped) {
    logger.warn("portal.support.email_skipped", { clientId, reason: "resend unset" });
    return { ok: false, error: "Email isn't connected yet, so we couldn't send that. Please reach out directly." };
  }
  if (!result.ok) return { ok: false, error: "Couldn't send your message — please try again." };
  return { ok: true };
}
