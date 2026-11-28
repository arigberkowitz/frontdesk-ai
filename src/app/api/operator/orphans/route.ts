import { handleOrphanDelete, handleOrphansList } from "@/lib/operator/handler";
import { liveAuthorize, liveOrphanDeps } from "@/lib/operator/live";

export const runtime = "nodejs";
// Lists vendor resources live; never cache.
export const dynamic = "force-dynamic";

/** Platform owner only: read-only list of vendor resources with no active business. */
export async function GET(): Promise<Response> {
  return handleOrphansList({ authorize: liveAuthorize, deps: liveOrphanDeps });
}

/** Platform owner only: delete ONE orphan (re-verified server-side to still be one). */
export async function POST(req: Request): Promise<Response> {
  return handleOrphanDelete(req, { authorize: liveAuthorize, deps: liveOrphanDeps });
}
