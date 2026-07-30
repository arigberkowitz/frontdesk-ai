import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentDbUserSafe, userMayAccessClient } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { microsoftAuthUrl, microsoftConfigured } from "@/lib/microsoft-calendar";

export const runtime = "nodejs";

/** One-time CSRF cookie that binds the OAuth round-trip to this browser session. */
const OAUTH_STATE_COOKIE = "mscal_oauth_state";
const OAUTH_COOKIE_PATH = "/api/calendar/microsoft";

/** Start the Outlook / Microsoft 365 OAuth flow for a client. */
export async function GET(req: Request): Promise<Response> {
  const clientId = new URL(req.url).searchParams.get("client") ?? "";
  const user = await getCurrentDbUserSafe();
  if (!user) return NextResponse.redirect(new URL("/sign-in", req.url));
  if (!microsoftConfigured()) {
    return new Response("Outlook connect isn't configured.", { status: 400 });
  }
  // Tenant rule lives in one place — a role-specific check here would let a
  // client_admin act on another business in the same house-agency org.
  if (!userMayAccessClient(user, clientId)) {
    return new Response("Forbidden", { status: 403 });
  }
  const client = await getClient(user.orgId, clientId);
  if (!client) return new Response("Client not found", { status: 404 });

  const nonce = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(microsoftAuthUrl(`${clientId}:${nonce}`));
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return res;
}
