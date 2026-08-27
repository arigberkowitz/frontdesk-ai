"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, services } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { isDeliverableUrl } from "@/lib/webhooks-out";
import { applyClientEdit, withSyncNote } from "@/lib/agent-publish";
import { type ActionState } from "./types";

/**
 * The switches for anything that texts a customer without being asked to.
 *
 * All of it is off until a business says otherwise, and the reason is the same
 * every time: these messages leave on the business's own number, unattended,
 * to people who did not ask us for them. Consent to that belongs to the
 * business, not to a default.
 */
export async function saveReviewRequestSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const reviewUrl = String(formData.get("reviewUrl") ?? "").trim();

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  await assertClientInOrg(user.orgId, clientId);

  if (reviewUrl && !isDeliverableUrl(reviewUrl)) {
    return {
      ok: false,
      fieldErrors: {
        reviewUrl: ["Needs to be a full https:// link — paste it from your Google Business page."],
      },
    };
  }
  // Turning it on with nowhere to send people would produce a text with a
  // missing link, which is worse than no text.
  if (enabled && !reviewUrl) {
    return {
      ok: false,
      fieldErrors: { reviewUrl: ["Add your review link before switching this on."] },
    };
  }

  await db
    .update(clients)
    .set({ reviewRequestsEnabled: enabled, reviewUrl: reviewUrl || null })
    .where(eq(clients.id, clientId));

  void audit({
    clientId,
    actor: user.id,
    action: "settings.review_requests",
    detail: { enabled },
  });
  revalidatePath("/portal/settings");
  return {
    ok: true,
    message: enabled
      ? "On. We'll ask customers for a review a few hours after their visit."
      : "Off. No review requests will be sent.",
  };
}

/**
 * Recall on or off. There is nothing else to configure here on purpose — the
 * interval belongs to the service, because "how long until they're due" is a
 * fact about a cleaning, not about a business.
 */
export async function saveRecallSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  await assertClientInOrg(user.orgId, clientId);

  // Turning it on with no service carrying an interval sends nothing, forever,
  // silently. Say so now rather than letting them wonder in three weeks.
  if (enabled) {
    const withInterval = await db.query.services.findFirst({
      where: and(
        eq(services.clientId, clientId),
        isNotNull(services.recallIntervalDays),
        isNull(services.deletedAt),
      ),
    });
    if (!withInterval) {
      return {
        ok: false,
        error:
          "No service has a rebook interval yet, so there would be nobody to text. Set \u201cBook them again after\u201d on a service first \u2014 180 days for a cleaning, 28 for a haircut.",
      };
    }
  }

  await db.update(clients).set({ recallEnabled: enabled }).where(eq(clients.id, clientId));
  void audit({ clientId, actor: user.id, action: "settings.recall", detail: { enabled } });
  revalidatePath("/portal/settings");
  return {
    ok: true,
    message: enabled
      ? "On. We'll invite past customers back when they're due."
      : "Off. No rebooking texts will be sent.",
  };
}

/**
 * Waitlist on or off.
 *
 * This one changes what the AI says on live calls, not just what gets texted
 * later: the `join_waitlist` tool is only attached to the agent when this is
 * on, so the receptionist never offers a waitlist a business doesn't keep.
 * That means the agent has to be republished, which `applyClientEdit` does.
 */
export async function saveWaitlistSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  await assertClientInOrg(user.orgId, clientId);

  await db.update(clients).set({ waitlistEnabled: enabled }).where(eq(clients.id, clientId));
  void audit({ clientId, actor: user.id, action: "settings.waitlist", detail: { enabled } });

  // Without this the database says yes and the live agent keeps the old tool
  // list — the exact half-wired state that has bitten this codebase before.
  const sync = await applyClientEdit(user, clientId);
  revalidatePath("/portal/settings");
  return {
    ok: true,
    message: withSyncNote(
      enabled
        ? "On. Callers who can't get the time they want will be offered a spot on the list."
        : "Off. The AI will stop offering a waitlist.",
      sync,
    ),
  };
}

/**
 * Deposits on or off, plus the link the money actually goes to.
 *
 * The link is THEIRS. We never run the checkout, because the Stripe account in
 * this codebase belongs to the operator and routing a dentist's deposits
 * through it would mean holding customer money on a business's behalf — a
 * regulated activity, not a feature flag. The right version of that is Stripe
 * Connect with each business onboarding its own account; until then this sends
 * their link at the moment it does the most good and stays out of the money.
 */
export async function saveDepositSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "on";
  const linkUrl = String(formData.get("depositLinkUrl") ?? "").trim();

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can change this." };
  }
  await assertClientInOrg(user.orgId, clientId);

  if (linkUrl && !isDeliverableUrl(linkUrl)) {
    return {
      ok: false,
      fieldErrors: {
        depositLinkUrl: [
          "Needs to be a full https:// payment link — from Stripe, Square, or whatever you already use to take card payments.",
        ],
      },
    };
  }
  if (enabled && !linkUrl) {
    return {
      ok: false,
      fieldErrors: {
        depositLinkUrl: ["Add your payment link first — a deposit text with nowhere to pay is worse than no text."],
      },
    };
  }
  if (enabled) {
    const withDeposit = await db.query.services.findFirst({
      where: and(
        eq(services.clientId, clientId),
        isNotNull(services.depositCents),
        isNull(services.deletedAt),
      ),
    });
    if (!withDeposit) {
      return {
        ok: false,
        error:
          "No service asks for a deposit yet, so nothing would be sent. Set a deposit amount on a service first.",
      };
    }
  }

  await db
    .update(clients)
    .set({ depositsEnabled: enabled, depositLinkUrl: linkUrl || null })
    .where(eq(clients.id, clientId));
  void audit({ clientId, actor: user.id, action: "settings.deposits", detail: { enabled } });
  revalidatePath("/portal/settings");
  return {
    ok: true,
    message: enabled
      ? "On. We'll text your payment link right after a booking that needs a deposit."
      : "Off. No deposit texts will be sent.",
  };
}
