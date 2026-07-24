"use server";

import { revalidatePath } from "next/cache";
import { assertClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
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
  const user = await assertClientEditor(clientId);
  await assertClientInOrg(user.orgId, clientId);

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const email = String(formData.get("email") ?? "").trim().slice(0, 200);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  if (!name || (!email && !phone)) return;
  if (email && !EMAIL_RE.test(email)) return;

  await addAlertContact(clientId, { name, email: email || null, phone: phone || null });
  revalidatePath("/portal/settings");
}

/** Flip a contact's on-duty switch. */
export async function toggleAlertContactAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientEditor(clientId);
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
  const user = await assertClientEditor(clientId);
  await assertClientInOrg(user.orgId, clientId);
  await setAllAlertContactsDuty(clientId, true);
  revalidatePath("/portal/settings");
}

export async function deleteAlertContactAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientEditor(clientId);
  await assertClientInOrg(user.orgId, clientId);
  await deleteAlertContact(clientId, String(formData.get("contactId") ?? ""));
  revalidatePath("/portal/settings");
}
