"use server";

import { assertClientAccess } from "@/lib/auth-guard";
import { serviceSchema, emptyToNull } from "@/lib/validation";
import { assertClientInOrg } from "@/lib/data/clients";
import * as servicesData from "@/lib/data/services";
import { applyClientEdit } from "@/lib/agent-publish";
import { type ActionState, fieldErrorsOf } from "./types";

function parseService(formData: FormData) {
  return serviceSchema.safeParse({
    name: formData.get("name"),
    durationMin: formData.get("durationMin"),
    priceDollars: formData.get("priceDollars") || undefined,
    description: formData.get("description"),
    isActive: formData.get("isActive") !== null,
  });
}

export async function createServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  const parsed = parseService(formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await assertClientInOrg(user.orgId, clientId);
  const d = parsed.data;
  await servicesData.createService(clientId, {
    name: d.name,
    durationMin: d.durationMin,
    priceCents: d.priceDollars != null ? Math.round(d.priceDollars * 100) : null,
    description: emptyToNull(d.description),
    isActive: d.isActive,
  });
  await applyClientEdit(user, clientId);
  return { ok: true };
}

export async function updateServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  const serviceId = String(formData.get("serviceId") ?? "");
  const parsed = parseService(formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  await assertClientInOrg(user.orgId, clientId);
  const d = parsed.data;
  await servicesData.updateService(clientId, serviceId, {
    name: d.name,
    durationMin: d.durationMin,
    priceCents: d.priceDollars != null ? Math.round(d.priceDollars * 100) : null,
    description: emptyToNull(d.description),
    isActive: d.isActive,
  });
  await applyClientEdit(user, clientId);
  return { ok: true };
}

export async function deleteServiceAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const user = await assertClientAccess(clientId);
  const serviceId = String(formData.get("serviceId") ?? "");
  await assertClientInOrg(user.orgId, clientId);
  await servicesData.deleteService(clientId, serviceId);
  await applyClientEdit(user, clientId);
}
