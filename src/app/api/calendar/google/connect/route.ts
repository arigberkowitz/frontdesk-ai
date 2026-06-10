import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentDbUserSafe } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { googleAuthUrl, googleConfigured } from "@/lib/google-calendar";

export const runtime = "nodejs";

/** One-time CSRF cookie that binds the OAuth round-trip to this browser session. */
const OAUTH_STATE_COOKIE = "gcal_oauth_state";
const OAUTH_COOKIE_PATH = "/api/calendar/google";

/** Start the Google Calendar OAuth flow for a client. */
export async function GET(req: Request): Promise<Response> {
  const clientId = new URL(req.url).searchParams.get("client") ?? "";
  const user = await getCurrentDbUserSafe();
  if (!user) return NextResponse.redirect(new URL("/sign-in", req.url));
  if (!googleConfigured()) return new Response("Google Calendar isn't configured.", { status: 400 });
  if (user.role === "client_viewer" && user.clientId !== clientId) {
    return new Response("Forbidden", { status: 403 });
  }
  const client = await getClient(user.orgId, clientId);
  if (!client) return new Response("Client not found", { status: 404 });

  // Bind the round-trip to this session: a random nonce travels in the OAuth `state`
  // and a matching httpOnly cookie. The callback rejects any mismatch, so an attacker
  // can't forge a callback that attaches their own Google account to this client.
  const nonce = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(googleAuthUrl(`${clientId}:${nonce}`));
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
