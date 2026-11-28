import { NextResponse } from "next/server";
import { calendarReturnPath, parseCalendarOAuthState } from "@/lib/calendar-oauth";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { getCurrentDbUserSafe, userMayEditClient } from "@/lib/auth-guard";
import { getClient, updateClient } from "@/lib/data/clients";
import { exchangeZoomCode, sealZoomTokens } from "@/lib/zoom";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const OAUTH_STATE_COOKIE = "zoom_oauth_state";
const OAUTH_COOKIE_PATH = "/api/calendar/zoom";

/** OAuth callback: store the (encrypted) Zoom tokens on the business. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const { clientId, nonce } = parseCalendarOAuthState(url.searchParams.get("state"));
  const oauthError = url.searchParams.get("error");

  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(calendarReturnPath("settings", status), req.url));
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  // CSRF: the nonce in `state` must match the one-time cookie set when the flow started.
  const cookieNonce = (await cookies()).get(OAUTH_STATE_COOKIE)?.value;
  const nonceOk =
    !!nonce &&
    !!cookieNonce &&
    nonce.length === cookieNonce.length &&
    timingSafeEqual(Buffer.from(nonce), Buffer.from(cookieNonce));
  if (!nonceOk) {
    logger.warn("calendar.zoom.state_mismatch", { clientId });
    return back("zoom_error");
  }

  const user = await getCurrentDbUserSafe();
  if (!user) return NextResponse.redirect(new URL("/sign-in", req.url));
  if (!(await userMayEditClient(user, clientId))) {
    return new Response("Forbidden", { status: 403 });
  }
  const client = await getClient(user.orgId, clientId);
  if (!client) return new Response("Client not found", { status: 404 });

  if (oauthError || !code) return back(oauthError === "access_denied" ? "zoom_noaccess" : "zoom_error");

  try {
    const { tokens, email } = await exchangeZoomCode(code);
    await updateClient(user.orgId, clientId, {
      zoomSecret: sealZoomTokens(tokens),
      zoomAccount: email,
      zoomConnectedAt: new Date(),
    });
    return back("zoom_connected");
  } catch (err) {
    logger.error("calendar.zoom.callback_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return back("zoom_error");
  }
}
