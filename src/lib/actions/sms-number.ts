"use server";

import { revalidatePath } from "next/cache";
import { requireAgencyOperator } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { findOtherClientWithSmsNumber, setClientSmsNumber } from "@/lib/data/sms-numbers";
import { audit } from "@/lib/data/audit";
import { checkTwilioNumber } from "@/lib/notifier";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  formatUsPhone,
  numberProblem,
  samePhone,
  toE164,
  type TwilioNumberCheck,
} from "@/lib/sms-number-format";
import { type ActionState } from "./types";

/**
 * Assign (or remove) a business's own texting number.
 *
 * Operator-only: an agency operator (the platform), never a business owner or
 * their staff — the number lives in the platform's Twilio account and its A2P
 * registration is the platform's responsibility. Nothing is purchased here:
 * the operator buys the number in Twilio and pastes it in. We only READ Twilio
 * to confirm the number is really in our account and can text, so a typo
 * can't silently send a business's texts from somebody else's number.
 *
 * Empty input removes the number: texts go back to the shared number and
 * replies fall back to "who last texted this customer" routing.
 */
export async function setClientSmsNumberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAgencyOperator();
  const clientId = String(formData.get("clientId") ?? "");
  const client = await assertClientInOrg(user.orgId, clientId);
  const raw = String(formData.get("smsNumber") ?? "").trim();

  if (!raw) {
    if (!client.smsNumber) return { ok: true, message: "This business already uses the shared number." };
    await setClientSmsNumber(user.orgId, clientId, null);
    void audit({
      clientId,
      actor: user.id,
      action: "sms_number.removed",
      detail: { previous: client.smsNumber },
    });
    revalidatePath(`/clients/${clientId}`);
    return {
      ok: true,
      message:
        "Removed. Texts for this business go out from the shared number again. Release the old number in Twilio only once you're sure nobody still replies to it.",
    };
  }

  const e164 = toE164(raw);
  if (!e164) {
    return {
      ok: false,
      fieldErrors: { smsNumber: ["Enter a US/Canada number, e.g. (415) 555-0123 or +14155550123"] },
    };
  }
  if (samePhone(e164, env.TWILIO_FROM_NUMBER)) {
    return {
      ok: false,
      fieldErrors: {
        smsNumber: ["That's the shared number every business uses — assign a number bought for this business."],
      },
    };
  }
  if (e164 === client.smsNumber) return { ok: true, message: "No change." };

  const other = await findOtherClientWithSmsNumber(e164, clientId);
  if (other) {
    return {
      ok: false,
      fieldErrors: { smsNumber: [`${formatUsPhone(e164)} is already assigned to ${other.name}.`] },
    };
  }

  let check: TwilioNumberCheck;
  try {
    check = await checkTwilioNumber(e164);
  } catch (err) {
    logger.warn("sms.number.twilio_check_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't reach Twilio to verify that number — try again in a moment." };
  }
  const problem = numberProblem(check);
  if (problem) return { ok: false, fieldErrors: { smsNumber: [problem] } };

  try {
    await setClientSmsNumber(user.orgId, clientId, e164);
  } catch (err) {
    // The partial unique index lost a race with another assignment.
    logger.warn("sms.number.save_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't save — that number may have just been assigned elsewhere." };
  }
  void audit({
    clientId,
    actor: user.id,
    action: "sms_number.assigned",
    detail: { previous: client.smsNumber, number: e164, verified: check.checked },
  });
  revalidatePath(`/clients/${clientId}`);
  return { ok: true, message: savedMessage(e164, check) };
}

function savedMessage(e164: string, check: TwilioNumberCheck): string {
  const base = `Saved. Texts for this business now go out from ${formatUsPhone(e164)}.`;
  if (!check.checked) {
    return `${base} Twilio isn't configured here, so the number wasn't verified.`;
  }
  if (!check.webhookOk) {
    return `${base} Heads up: in Twilio, set this number's "A message comes in" webhook to POST ${env.APP_URL.replace(/\/$/, "")}/api/webhooks/twilio (or check its Messaging Service), or replies and STOP won't reach us.`;
  }
  return base;
}
