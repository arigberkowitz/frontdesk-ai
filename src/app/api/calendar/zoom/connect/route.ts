import { NextResponse } from "next/server";
import { buildCalendarOAuthState, calendarReturnPath } from "@/lib/calendar-oauth";
import { randomBytes } from "node:crypto";
import { getCurrentDbUserSafe, userMayEditClient } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { zoomAuthUrl, zoomConfigured } from "@/lib/zoom";

export const runtime = "nodejs";

/** One-time CSRF cookie that binds the OAuth round-trip to this browser session. */
const OAUTH_STATE_COOKIE = "zoom_oauth_state";
const OAUTH_COOKIE_PATH = "/api/calendar/zoom";

/** Start the "Connect Zoom" OAuth flow for a business. Same shape as the Google connect. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client") ?? "";
  const user = await getCurrentDbUserSafe();
  if (!user) return NextResponse.redirect(new URL("/sign-in", req.url));
  // Hidden until ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET are set.
  if (!zoomConfigured()) {
    return NextResponse.redirect(new URL(calendarReturnPath("settings", "zoom_unavailable"), req.url));
  }
  // Editor rule: connecting Zoom changes what link the AI sends customers.
  if (!(await userMayEditClient(user, clientId))) {
    return new Response("Forbidden", { status: 403 });
  }
  const client = await getClient(user.orgId, clientId);
  if (!client) return new Response("Client not found", { status: 404 });

  const nonce = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(zoomAuthUrl(buildCalendarOAuthState(clientId, nonce, "settings")));
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
