import { NextResponse } from "next/server";
import { buildCalendarOAuthState, calendarReturnFrom } from "@/lib/calendar-oauth";
import { randomBytes } from "node:crypto";
import { getCurrentDbUserSafe, userMayEditClient } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { microsoftAuthUrl, microsoftConfigured } from "@/lib/microsoft-calendar";

export const runtime = "nodejs";

/** One-time CSRF cookie that binds the OAuth round-trip to this browser session. */
const OAUTH_STATE_COOKIE = "mscal_oauth_state";
const OAUTH_COOKIE_PATH = "/api/calendar/microsoft";

/** Start the Outlook / Microsoft 365 OAuth flow for a client. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client") ?? "";
  const from = calendarReturnFrom(url.searchParams.get("from"));
  const user = await getCurrentDbUserSafe();
  if (!user) return NextResponse.redirect(new URL("/sign-in", req.url));
  if (!microsoftConfigured()) {
    return new Response("Outlook connect isn't configured.", { status: 400 });
  }
  // Tenant rule lives in one place — a role-specific check here would let a
  // client_admin act on another business in the same house-agency org.
  // Editor rule, not just tenant access: connecting replaces the calendar the
  // AI books into, which the Cal.com connect action already limits to
  // editors. Staff could do it here with a plain link.
  if (!(await userMayEditClient(user, clientId))) {
    return new Response("Forbidden", { status: 403 });
  }
  const client = await getClient(user.orgId, clientId);
  if (!client) return new Response("Client not found", { status: 404 });

  const nonce = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(microsoftAuthUrl(buildCalendarOAuthState(clientId, nonce, from)));
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
