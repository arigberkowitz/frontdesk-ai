import { getCurrentDbUserSafe, userMayAccessClient } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { clientExportResponse } from "@/lib/client-export";

export const runtime = "nodejs";

/** CSV export for a client's calls / appointments / leads (§14, §17). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // Operator-only was the wrong gate. This is the export a customer is told
  // they have — the privacy policy promises they can take their data "directly
  // in the product" — and it was reachable only by the one person who doesn't
  // need it. `userMayAccessClient` is the single tenant rule: operators reach
  // any client in their org, everyone else reaches only their own, so widening
  // the role check here does not widen who can read whose data.
  const user = await getCurrentDbUserSafe();
  if (!user || !userMayAccessClient(user, id)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    await assertClientInOrg(user.orgId, id);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return clientExportResponse(id, req);
}
