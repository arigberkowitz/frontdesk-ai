import { NextResponse } from "next/server";
import { PORTAL_PREVIEW_COOKIE, requireOperator } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";
import { resolvePortalPreviewNext } from "@/lib/today-inbox";

/**
 * Operator entry point: start previewing a client's portal. Verifies the client
 * belongs to the operator's org, drops a scoped cookie, and lands on /portal —
 * which then renders exactly what that client sees. No second login required.
 * An optional `?next=/portal/...` deep-links to one portal page (the Today
 * inbox uses it for actions that only exist in the portal); anything that
 * isn't a /portal path is ignored.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await requireOperator();
  const client = await getClient(user.orgId, id);
  if (!client) return NextResponse.redirect(new URL("/clients", req.url));

  const next = resolvePortalPreviewNext(new URL(req.url).searchParams.get("next"));
  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set(PORTAL_PREVIEW_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60, // 1 hour
  });
  return res;
}
