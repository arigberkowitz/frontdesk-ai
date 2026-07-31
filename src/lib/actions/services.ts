"use server";

import { requireClientEditor } from "@/lib/auth-guard";
import { serviceSchema, emptyToNull } from "@/lib/validation";
import { assertClientInOrg } from "@/lib/data/clients";
import * as servicesData from "@/lib/data/services";
import { applyClientEdit, withSyncNote } from "@/lib/agent-publish";
import { type ActionState, fieldErrorsOf } from "./types";

function parseService(formData: FormData) {
  return serviceSchema.safeParse({
    name: formData.get("name"),
    durationMin: formData.get("durationMin"),
    priceDollars: formData.get("priceDollars") || undefined,
    providerCount: formData.get("providerCount") || 1,
    description: formData.get("description"),
    virtualOk: formData.get("virtualOk") !== null,
    isActive: formData.get("isActive") !== null,
  });
}

export async function createServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  const parsed = parseService(formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await assertClientInOrg(user.orgId, clientId);
  const d = parsed.data;
  await servicesData.createService(clientId, {
    name: d.name,
    durationMin: d.durationMin,
    priceCents: d.priceDollars != null ? Math.round(d.priceDollars * 100) : null,
    providerCount: d.providerCount,
    description: emptyToNull(d.description),
    virtualOk: d.virtualOk,
    isActive: d.isActive,
  });
  const sync = await applyClientEdit(user, clientId);
  return { ok: true, message: withSyncNote("Saved.", sync) };
}

export async function updateServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  const serviceId = String(formData.get("serviceId") ?? "");
  const parsed = parseService(formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await assertClientInOrg(user.orgId, clientId);
  const d = parsed.data;
  await servicesData.updateService(clientId, serviceId, {
    name: d.name,
    durationMin: d.durationMin,
    priceCents: d.priceDollars != null ? Math.round(d.priceDollars * 100) : null,
    providerCount: d.providerCount,
    description: emptyToNull(d.description),
    virtualOk: d.virtualOk,
    isActive: d.isActive,
  });
  const sync = await applyClientEdit(user, clientId);
  return { ok: true, message: withSyncNote("Saved.", sync) };
}

export async function deleteServiceAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  const serviceId = String(formData.get("serviceId") ?? "");
  await assertClientInOrg(user.orgId, clientId);
  await servicesData.deleteService(clientId, serviceId);
  await applyClientEdit(user, clientId);
}
