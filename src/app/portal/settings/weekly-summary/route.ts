import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { renderWeeklySummaryForClient } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preview of this business's weekly summary email, with its real numbers for
 * the last 7 days. Renders only — never sends, never records a send. Scoped to
 * the session's business (or the operator's previewed portal).
 */
export async function GET(): Promise<Response> {
  const { clientId } = await resolvePortalClient();
  const client = await getClientByIdUnsafe(clientId);
  if (!client) return new Response("Not found", { status: 404 });
  const email = await renderWeeklySummaryForClient(client);
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Weekly summary preview</title></head>
<body style="margin:0;background:#f4f4f5;padding:24px">
<p style="font-family:system-ui,sans-serif;font-size:12px;color:#71717a;text-align:center;margin:0 0 4px">Preview — nothing is sent from this page${client.weeklySummaryEnabled ? "" : " · the weekly summary is currently OFF for this business"}</p>
<p style="font-family:system-ui,sans-serif;font-size:13px;color:#3f3f46;text-align:center;margin:0 0 16px"><strong>Subject:</strong> ${email.subject.replace(/[<>&]/g, "")}</p>
<div style="background:#fff;max-width:560px;margin:0 auto;padding:24px;border-radius:12px">${email.html}</div>
</body></html>`;
  return new Response(page, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
