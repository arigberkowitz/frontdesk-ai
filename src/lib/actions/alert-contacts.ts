"use server";

import { revalidatePath } from "next/cache";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { toE164 } from "@/lib/format";
import {
  addAlertContact,
  deleteAlertContact,
  setAlertContactDuty,
  setAllAlertContactsDuty,
} from "@/lib/data/alert-contacts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Add someone to the alert roster (name + email and/or phone). */
export async function addAlertContactAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const email = String(formData.get("email") ?? "").trim().slice(0, 200);
  const rawPhone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  if (!name || (!email && !rawPhone)) return;
  if (email && !EMAIL_RE.test(email)) return;

  // A typo'd number here is worse than no number. The first roster entry with
  // a phone becomes the ONLY SMS target — it displaces the fallback to the
  // owner's own escalation number — so one unparseable digit string silently
  // stops every booking alert, every message alert and every 🚨 emergency text
  // from reaching anyone at all. Store E.164 or store nothing.
  const phone = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && !phone) return;

  await addAlertContact(clientId, { name, email: email || null, phone });
  revalidatePath("/portal/settings");
}

/** Flip a contact's on-duty switch. */
export async function toggleAlertContactAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);
  await setAlertContactDuty(
    clientId,
    String(formData.get("contactId") ?? ""),
    String(formData.get("onDuty")) === "true",
  );
  revalidatePath("/portal/settings");
}

/** One click: everyone on the roster gets every alert. */
export async function allOnDutyAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);
  await setAllAlertContactsDuty(clientId, true);
  revalidatePath("/portal/settings");
}

export async function deleteAlertContactAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);
  await deleteAlertContact(clientId, String(formData.get("contactId") ?? ""));
  revalidatePath("/portal/settings");
}
