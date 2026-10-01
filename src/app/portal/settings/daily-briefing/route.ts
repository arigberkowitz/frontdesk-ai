import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { dailyBriefingEnabled, renderDailyBriefingForClient } from "@/lib/briefing-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preview of this business's daily briefing as it would be written right now,
 * from its real data. Renders only — never sends an email and never records a
 * send (so it doesn't count as today's briefing). Scoped to the session's
 * business (or the operator's previewed portal).
 */
export async function GET(): Promise<Response> {
  const { clientId } = await resolvePortalClient();
  const client = await getClientByIdUnsafe(clientId);
  if (!client) return new Response("Not found", { status: 404 });
  const b = await renderDailyBriefingForClient(client);
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Daily briefing preview</title></head>
<body style="margin:0;background:#f4f4f5;padding:24px">
<p style="font-family:system-ui,sans-serif;font-size:12px;color:#71717a;text-align:center;margin:0 0 4px">Preview — nothing is sent from this page${dailyBriefingEnabled(client) ? "" : " · the daily briefing is currently OFF for this business"}${b.usedAi ? "" : " · written from the template (quiet day, or the AI writer is unavailable)"}</p>
<p style="font-family:system-ui,sans-serif;font-size:13px;color:#3f3f46;text-align:center;margin:0 0 16px"><strong>Subject:</strong> ${b.subject.replace(/[<>&]/g, "")}</p>
<div style="background:#fff;max-width:560px;margin:0 auto;padding:24px;border-radius:12px">${b.html}</div>
</body></html>`;
  return new Response(page, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
