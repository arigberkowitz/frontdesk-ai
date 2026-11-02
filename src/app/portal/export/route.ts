import { resolvePortalClient } from "@/lib/auth-guard";
import { clientExportResponse } from "@/lib/client-export";

export const runtime = "nodejs";

/**
 * Customer-facing CSV export (Settings → Export). The business comes from the
 * signed-in session, so the link carries no client id — same as
 * /portal/leads/export. The id-based /api/clients/[id]/export stays for the
 * operator dashboard.
 */
export async function GET(req: Request): Promise<Response> {
  const { clientId } = await resolvePortalClient();
  return clientExportResponse(clientId, req);
}
