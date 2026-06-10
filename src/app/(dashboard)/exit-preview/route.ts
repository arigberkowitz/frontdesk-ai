import { NextResponse } from "next/server";
import { PORTAL_PREVIEW_COOKIE } from "@/lib/auth-guard";

/** Clear the operator's portal-preview cookie and return to the clients list. */
export async function GET(req: Request): Promise<Response> {
  const res = NextResponse.redirect(new URL("/clients", req.url));
  res.cookies.delete(PORTAL_PREVIEW_COOKIE);
  return res;
}
