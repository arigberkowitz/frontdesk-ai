import "server-only";
import twilio from "twilio";
import { env, webhookUrl } from "@/lib/env";
import type { TollfreeVerificationPayload } from "./payload";

/** A verification as we read it back from Twilio. */
export interface VerificationRecord {
  sid: string;
  status: string;
  rejectionReason?: string | null;
  rejectionReasons?: Array<Record<string, unknown>> | null;
  editAllowed?: boolean | null;
}

/**
 * Every Twilio call this feature makes, behind one interface so tests (and
 * anything else) can swap in a mock. Nothing outside this file talks to Twilio.
 */
export interface TollfreeApi {
  /** Buy one US toll-free number, SMS routed to our webhook. Spends money. */
  buyNumber(friendlyName: string): Promise<{ phoneNumber: string; sid: string }>;
  submit(payload: TollfreeVerificationPayload): Promise<VerificationRecord>;
  /** Edit a rejected verification in place (only when Twilio says editAllowed). */
  resubmit(sid: string, payload: TollfreeVerificationPayload): Promise<VerificationRecord>;
  fetch(sid: string): Promise<VerificationRecord>;
}

function toRecord(v: {
  sid: string;
  status: string;
  rejectionReason?: string | null;
  rejectionReasons?: unknown;
  editAllowed?: boolean | null;
}): VerificationRecord {
  return {
    sid: v.sid,
    status: v.status,
    rejectionReason: v.rejectionReason ?? null,
    rejectionReasons: Array.isArray(v.rejectionReasons) ? (v.rejectionReasons as Array<Record<string, unknown>>) : null,
    editAllowed: v.editAllowed ?? null,
  };
}

export function twilioTollfreeApi(): TollfreeApi {
  const client = () => twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return {
    async buyNumber(friendlyName) {
      const c = client();
      const [available] = await c.availablePhoneNumbers("US").tollFree.list({ smsEnabled: true, limit: 1 });
      if (!available) throw new Error("No toll-free numbers available right now");
      // SMS-only: no voiceUrl. Calls stay on the business's AI (Retell) number.
      const bought = await c.incomingPhoneNumbers.create({
        phoneNumber: available.phoneNumber,
        friendlyName,
        smsUrl: webhookUrl("/api/webhooks/twilio"),
        smsMethod: "POST",
      });
      return { phoneNumber: bought.phoneNumber, sid: bought.sid };
    },
    async submit(payload) {
      return toRecord(await client().messaging.v1.tollfreeVerifications.create(payload));
    },
    async resubmit(sid, payload) {
      const { tollfreePhoneNumberSid: _sid, externalReferenceId: _ref, ...editable } = payload;
      void _sid;
      void _ref;
      return toRecord(
        await client()
          .messaging.v1.tollfreeVerifications(sid)
          .update({ ...editable, editReason: "Business details corrected by the owner" }),
      );
    },
    async fetch(sid) {
      return toRecord(await client().messaging.v1.tollfreeVerifications(sid).fetch());
    },
  };
}
