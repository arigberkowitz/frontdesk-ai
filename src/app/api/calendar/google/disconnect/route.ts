import { NextResponse } from "next/server";
import { getCurrentDbUserSafe } from "@/lib/auth-guard";
import { getClient, updateClient } from "@/lib/data/clients";

export const runtime = "nodejs";

/** Disconnect a client's calendar — clears the stored connection. */
export async function GET(req: Request): Promise<Response> {
  const clientId = new URL(req.url).searchParams.get("client") ?? "";
  const user = await getCurrentDbUserSafe();
  if (!user) return NextResponse.redirect(new URL("/sign-in", req.url));
  if (user.role === "client_viewer" && user.clientId !== clientId) {
    return new Response("Forbidden", { status: 403 });
  }
  const client = await getClient(user.orgId, clientId);
  if (!client) return new Response("Client not found", { status: 404 });

  await updateClient(user.orgId, clientId, {
    calendarProvider: null,
    calendarSecret: null,
    calendarId: null,
    calendarAccount: null,
    calendarConnectedAt: null,
  });
  return NextResponse.redirect(new URL("/portal/appointments?calendar=disconnected", req.url));
}
