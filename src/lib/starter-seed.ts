import "server-only";
import * as clientsData from "@/lib/data/clients";
import * as servicesData from "@/lib/data/services";
import * as knowledgeData from "@/lib/data/knowledge";
import * as hoursData from "@/lib/data/hours";
import { packForIndustry, type StarterPack } from "@/config/starter-packs";

/**
 * Seed a freshly-created client with its industry starter pack: services, FAQ,
 * hours, and industry-tuned guardrails/booking instructions — all editable.
 * Call ONLY on a brand-new client (nothing here checks for existing content).
 */
export async function seedClientFromPack(
  orgId: string,
  clientId: string,
  industry: string | null,
  pack: StarterPack = packForIndustry(industry),
): Promise<void> {
  await Promise.all([
    ...pack.services.map((s) => servicesData.createService(clientId, { ...s, isActive: true })),
    ...pack.faq.map((f) =>
      knowledgeData.createKnowledge(clientId, { ...f, source: "manual", isActive: true }),
    ),
    hoursData.setWeekHours(clientId, pack.hours),
    clientsData.updateClient(orgId, clientId, {
      industry: industry || pack.industry,
      agentGuidance: pack.guardrails,
      bookingInstructions: pack.booking,
    }),
  ]);
}
