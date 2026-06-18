import { resolvePortalClient } from "@/lib/auth-guard";
import { listLeads } from "@/lib/data/leads";
import { toCsv } from "@/lib/csv";

export const runtime = "nodejs";

/** Portal-facing lead export — a business downloads its own leads as CSV, which
 *  imports cleanly into any CRM (HubSpot, Salesforce, a spreadsheet, etc.). */
export async function GET(): Promise<Response> {
  const { clientId } = await resolvePortalClient();
  const rows = await listLeads(clientId);
  const csv = toCsv(
    ["Captured", "Name", "Phone", "Reason", "Wants", "Timing", "Budget", "Message", "Status"],
    rows.map((l) => [
      l.createdAt.toISOString(),
      l.name,
      l.phone,
      l.reason,
      l.service,
      l.urgency,
      l.budget,
      l.message,
      l.status,
    ]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads.csv"`,
    },
  });
}
