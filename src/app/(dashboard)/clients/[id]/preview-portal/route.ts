import { NextResponse } from "next/server";
import { PORTAL_PREVIEW_COOKIE, requireOperator } from "@/lib/auth-guard";
import { getClient } from "@/lib/data/clients";

/**
 * Operator entry point: start previewing a client's portal. Verifies the client
 * belongs to the operator's org, drops a scoped cookie, and lands on /portal —
 * which then renders exactly what that client sees. No second login required.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await requireOperator();
  const client = await getClient(user.orgId, id);
  if (!client) return NextResponse.redirect(new URL("/clients", req.url));

  const res = NextResponse.redirect(new URL("/portal", req.url));
  res.cookies.set(PORTAL_PREVIEW_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1 hour
  });
  return res;
}
