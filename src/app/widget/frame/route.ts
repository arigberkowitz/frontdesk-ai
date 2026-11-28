import { logger } from "@/lib/logger";
import { getWidgetFrameClient } from "@/lib/data/clients";
import { planAccessFor } from "@/lib/plan-access";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
import { isWidgetKey, safeAccent, widgetLang, widgetSettings } from "@/lib/chat/widget-access";
import { frameCsp, frameHtml } from "@/lib/chat/widget-frame";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Businesses whose chat stays up; same set as /api/chat. */
const CHAT_STATUSES = new Set(["draft", "trial", "live"]);

/**
 * The website chat iframe. Embedded on the business's site by public/widget.js
 * (one script tag), served from our domain so the chat runs isolated from the
 * host page: its CSS can't reach in, its scripts can't read the transcript,
 * and our CSP applies inside. See src/lib/chat/widget-frame.ts.
 *
 * Unavailable (unknown key, chat off, paused, or not on Pro) renders an empty
 * frame that tells the embed script to remove itself, so a lapsed plan leaves
 * no dead bubble on the owner's site.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const lang = widgetLang(url.searchParams.get("lang"));
  const accent = safeAccent(url.searchParams.get("accent"));
  const preview = url.searchParams.get("preview") === "1";
  const assetVersion = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 8) || undefined;

  const unavailable = () =>
    respond(frameHtml({ available: false, lang, accent, assetVersion }), frameCsp(null));

  if (!isWidgetKey(key)) return unavailable();
  let client: Awaited<ReturnType<typeof getWidgetFrameClient>>;
  try {
    client = await getWidgetFrameClient(key);
  } catch (err) {
    logger.error("widget.frame_lookup_failed", { error: err instanceof Error ? err.message : String(err) });
    return unavailable();
  }
  if (!client || !CHAT_STATUSES.has(client.status)) return unavailable();
  const access = await planAccessFor(client).catch(() => null);
  if (!access?.has("website_chat")) return unavailable();

  const settings = widgetSettings(client.setupFlags);
  return respond(
    frameHtml({
      available: true,
      key,
      businessName: client.name,
      agentName: client.agentName?.trim() || DEFAULT_AGENT_NAME,
      lang,
      accent,
      preview,
      assetVersion,
    }),
    frameCsp(settings.domains),
  );
}

function respond(html: string, csp: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    },
  });
}
