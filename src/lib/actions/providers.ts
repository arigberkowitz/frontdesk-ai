"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, providers } from "@/db/schema";
import { assertClientAccess, assertClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { applyClientEdit } from "@/lib/agent-publish";
import { type ActionState } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Admin: turn staff mode on/off for the business. */
export async function setStaffModeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your admin can change staff mode." };
  }
  await db.update(clients).set({ staffModeEnabled: enabled }).where(eq(clients.id, clientId));
  await applyClientEdit(user, clientId); // the live agent starts/stops offering "who would you like to see?"
  return {
    ok: true,
    message: enabled
      ? "Staff mode is on — add your team below, and the AI can book by person."
      : "Staff mode is off — booking works the simple way again.",
  };
}

/** Add a team member. */
export async function addProviderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientEditor(clientId);
  await assertClientInOrg(user.orgId, clientId);

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!name) return { ok: false, fieldErrors: { name: ["Name is required"] } };
  if (name.length > 80) return { ok: false, fieldErrors: { name: ["Keep it under 80 characters"] } };
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, fieldErrors: { email: ["Enter a valid email"] } };
  }

  await db.insert(providers).values({
    clientId,
    name,
    email: email || null,
    phone: phone || null,
    onClock: false,
  });
  await applyClientEdit(user, clientId);
  return { ok: true, message: `${name} added to the team.` };
}

/** Remove a team member (their past appointments keep their name via soft link). */
export async function removeProviderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const user = await assertClientEditor(clientId);
  await assertClientInOrg(user.orgId, clientId);

  await db
    .update(providers)
    .set({ deletedAt: new Date(), onClock: false })
    .where(and(eq(providers.id, providerId), eq(providers.clientId, clientId)));
  await applyClientEdit(user, clientId);
  return { ok: true, message: "Removed from the team." };
}

/** Clock in / out. Staff can clock THEMSELVES (matched by login email); admins anyone. */
export async function setClockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");
  const onClock = String(formData.get("onClock") ?? "") === "true";
  const user = await assertClientAccess(clientId);

  const row = await db.query.providers.findFirst({
    where: and(eq(providers.id, providerId), eq(providers.clientId, clientId)),
  });
  if (!row) return { ok: false, error: "Team member not found." };

  const isAdmin = user.role === "operator" || user.role === "client_admin";
  const isSelf = Boolean(row.email && row.email.toLowerCase() === user.email.toLowerCase());
  if (!isAdmin && !isSelf) {
    return { ok: false, error: "You can only clock yourself in or out." };
  }

  await db.update(providers).set({ onClock }).where(eq(providers.id, providerId));
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message: onClock
      ? `${row.name} is on the clock — bookable and getting alerts.`
      : `${row.name} clocked out.`,
  };
}
