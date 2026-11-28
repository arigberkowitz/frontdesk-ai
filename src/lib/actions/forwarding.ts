"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientOwner } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { audit } from "@/lib/data/audit";
import { forwardingTestDeps } from "@/lib/data/forwarding-test";
import { pollForwardingTest, startForwardingTest, samePhone, type ForwardingTestView } from "@/lib/forwarding-test";
import { toE164, formatPhone } from "@/lib/format";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * "Test my forwarding" — owner or operator only. The destination is always the
 * business line saved on the business, never something typed into this request,
 * so the button can't be turned into a way to ring an arbitrary number.
 */
export async function startForwardingTestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientOwner(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const result = await startForwardingTest(forwardingTestDeps(), { clientId, actorId: guard.user.id });
  if (!result.ok) {
    logger.info("forwarding_test.refused", { clientId, code: result.code });
    return { ok: false, error: result.error, data: { code: result.code } };
  }
  logger.info("forwarding_test.placed", { clientId, testId: result.test.id, mode: result.test.mode });
  return { ok: true, data: { testId: result.test.id, waitMs: result.waitMs } };
}

/** Polled by the card while a test runs. Returns the Pass/Fail view, or null if the test is gone. */
export async function checkForwardingTestAction(
  clientId: string,
  testId: string,
): Promise<ForwardingTestView | null> {
  const guard = await requireClientOwner(String(clientId));
  if (!guard.ok) return null;
  await assertClientInOrg(guard.user.orgId, clientId);
  const view = await pollForwardingTest(forwardingTestDeps(), clientId, String(testId));
  if (view?.status === "passed") revalidatePath("/portal", "layout");
  return view;
}

/**
 * The business line customers call (the number the AI forwarding is set up on).
 * Owner-only: it's the destination of the test call and what the transfer-loop
 * guard compares against.
 */
export async function saveBusinessLineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const raw = String(formData.get("businessLine") ?? "").trim();
  const guard = await requireClientOwner(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const e164 = toE164(raw);
  if (!e164) {
    return {
      ok: false,
      fieldErrors: { businessLine: ["Enter the full number with area code, like (415) 555-0100."] },
    };
  }
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    columns: { retellPhoneNumber: true, escalationNumber: true, forwardingNumber: true },
  });
  if (!client) return { ok: false, error: "Business not found." };
  if (samePhone(e164, client.retellPhoneNumber)) {
    return {
      ok: false,
      fieldErrors: { businessLine: ["That's your AI's own number. Enter the number your customers already call."] },
    };
  }
  if (samePhone(e164, client.escalationNumber)) {
    return {
      ok: false,
      fieldErrors: {
        businessLine: [
          "That's the number your AI transfers callers to. Forwarding it to the AI would send transfers straight back. Use a different number for transfers first.",
        ],
      },
    };
  }

  const changed = !samePhone(e164, client.forwardingNumber);
  await db
    .update(clients)
    .set({
      forwardingNumber: e164,
      // A new line hasn't been proven yet. Forwarding "on" stays the owner's call.
      ...(changed
        ? {
            setupFlags: sql`(coalesce(${clients.setupFlags}, '{}'::jsonb) - 'forwardingVerifiedAt') - 'forwardingTest'`,
          }
        : {}),
    })
    .where(eq(clients.id, clientId));
  void audit({
    clientId,
    actor: guard.user.id,
    action: "forwarding.business_line_set",
    detail: { to: e164 },
  });
  revalidatePath("/portal", "layout");
  return { ok: true, message: `Saved. We'll test ${formatPhone(e164)}.` };
}
