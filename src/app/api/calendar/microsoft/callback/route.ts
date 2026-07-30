import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { getCurrentDbUserSafe } from "@/lib/auth-guard";
import { getClient, updateClient } from "@/lib/data/clients";
import { exchangeMsCodeForTokens } from "@/lib/microsoft-calendar";
import { encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const OAUTH_STATE_COOKIE = "mscal_oauth_state";
const OAUTH_COOKIE_PATH = "/api/calendar/microsoft";

/** OAuth callback: store the (encrypted) refresh token on the client. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const [clientId = "", nonce] = (url.searchParams.get("state") ?? "").split(":");
  const oauthError = url.searchParams.get("error");

  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/portal/appointments?calendar=${status}`, req.url));
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  const cookieNonce = (await cookies()).get(OAUTH_STATE_COOKIE)?.value;
  const nonceOk =
    !!nonce &&
    !!cookieNonce &&
    nonce.length === cookieNonce.length &&
    timingSafeEqual(Buffer.from(nonce), Buffer.from(cookieNonce));
  if (!nonceOk) {
    logger.warn("calendar.microsoft.state_mismatch", { clientId });
    return back("error");
  }

  const user = await getCurrentDbUserSafe();
  if (!user) return NextResponse.redirect(new URL("/sign-in", req.url));
  if (user.role === "client_viewer" && user.clientId !== clientId) {
    return new Response("Forbidden", { status: 403 });
  }
  const client = await getClient(user.orgId, clientId);
  if (!client) return new Response("Client not found", { status: 404 });

  if (oauthError || !code) return back("error");

  try {
    const { refreshToken, email } = await exchangeMsCodeForTokens(code);
    if (!refreshToken) return back("noaccess");
    await updateClient(user.orgId, clientId, {
      calendarProvider: "microsoft",
      calendarSecret: encryptSecret(refreshToken),
      calendarId: "primary",
      calendarAccount: email,
      calendarConnectedAt: new Date(),
    });
    return back("connected");
  } catch (err) {
    logger.error("calendar.microsoft.callback_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return back("error");
  }
}
