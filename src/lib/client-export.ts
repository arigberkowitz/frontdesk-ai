import "server-only";
import { listCalls } from "@/lib/data/calls";
import { listAppointments } from "@/lib/data/appointments";
import { listLeads } from "@/lib/data/leads";
import { toCsv } from "@/lib/csv";

/**
 * CSV export of one client's calls / appointments / leads. No access check
 * here: callers resolve and authorize the client first (the operator route
 * by id, the portal route from the signed-in session).
 */
export async function clientExportResponse(id: string, req: Request): Promise<Response> {
  const type = new URL(req.url).searchParams.get("type") ?? "calls";
  let csv: string;
  let filename: string;

  if (type === "appointments") {
    const rows = await listAppointments(id);
    csv = toCsv(
      ["Created", "Customer", "Phone", "Service", "Start", "End", "Status"],
      rows.map((a) => [
        a.createdAt.toISOString(),
        a.customerName,
        a.customerPhone,
        a.service?.name ?? "",
        a.startAt.toISOString(),
        a.endAt?.toISOString() ?? "",
        a.status,
      ]),
    );
    filename = "appointments.csv";
  } else if (type === "leads") {
    const rows = await listLeads(id);
    csv = toCsv(
      ["Created", "Name", "Phone", "Reason", "Wants", "Timing", "Budget", "Message", "Status"],
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
    filename = "leads.csv";
  } else {
    const rows = await listCalls(id, 1000);
    csv = toCsv(
      ["Start", "From", "To", "DurationSec", "Outcome", "Sentiment", "AfterHours", "Summary"],
      rows.map((c) => [
        c.startAt?.toISOString() ?? "",
        c.fromNumber,
        c.toNumber,
        c.durationSec,
        c.outcome,
        c.sentiment,
        c.isAfterHours,
        c.summary,
      ]),
    );
    filename = "calls.csv";
  }

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
