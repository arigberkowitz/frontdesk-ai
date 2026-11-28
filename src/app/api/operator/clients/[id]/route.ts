import { handleClientControl } from "@/lib/operator/handler";
import { liveAuthorize, liveControlDeps } from "@/lib/operator/live";

export const runtime = "nodejs";

/**
 * Operator-only controls for one business: release number, delete agent,
 * suspend / reactivate, delete company. Authorized on the server by
 * liveAuthorize (agency operator for their own business, or the platform
 * owner) — a client_admin / client_viewer gets 403 here whatever the UI shows.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleClientControl(req, id, { authorize: liveAuthorize, deps: liveControlDeps });
}
