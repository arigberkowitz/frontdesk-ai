"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, services } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { isDeliverableUrl } from "@/lib/webhooks-out";
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
