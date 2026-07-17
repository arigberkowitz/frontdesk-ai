"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { env } from "@/lib/env";
import { type ActionState } from "./types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Manager invites their own staff from the portal. Invitees sign up via the
 * emailed link and land as `client_viewer` (staff) — the admin already exists,
 * so the first-user-becomes-admin bootstrap can't promote them. Staff see
 * everything and work leads; AI changes stay behind the edit code.
 */
export async function inviteStaffAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your admin can invite team members." };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, fieldErrors: { email: ["Enter a valid email"] } };
  }
  if (!process.env.CLERK_SECRET_KEY) {
    return { ok: false, error: "Invites aren't available yet — contact support." };
  }

  try {
    const clerk = await clerkClient();
    await clerk.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { role: "client_viewer", clientId },
      redirectUrl: `${env.APP_URL}/portal`,
      ignoreExisting: true,
    });
    return { ok: true, message: `Invite sent to ${email}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invite failed." };
  }
}
