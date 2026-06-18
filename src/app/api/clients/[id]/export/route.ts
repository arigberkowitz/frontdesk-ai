import { getCurrentDbUserSafe } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { listCalls } from "@/lib/data/calls";
import { listAppointments } from "@/lib/data/appointments";
import { listLeads } from "@/lib/data/leads";
import { toCsv } from "@/lib/csv";

export const runtime = "nodejs";

/** CSV export for a client's calls / appointments / leads (§14, §17). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const user = await getCurrentDbUserSafe();
  if (!user || user.role !== "operator") {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    await assertClientInOrg(user.orgId, id);
  } catch {
    return new Response("Not found", { status: 404 });
  }

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
