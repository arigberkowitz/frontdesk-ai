"use server";

import { requireAgencyOperator } from "@/lib/auth-guard";
import { prospectWebsites, type ProspectReport } from "@/lib/agents/growth";

export interface GrowthState {
  reports: ProspectReport[] | null;
  error?: string;
}

/** Run the growth agent over pasted prospect URLs (agency operators only). */
export async function prospectAction(
  _prev: GrowthState,
  formData: FormData,
): Promise<GrowthState> {
  await requireAgencyOperator();

  const raw = String(formData.get("urls") ?? "");
  const urls = raw
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && s.includes("."));

  if (urls.length === 0) return { reports: null, error: "Paste at least one website." };
  const reports = await prospectWebsites(urls);
  return { reports };
}
