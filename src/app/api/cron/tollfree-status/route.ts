import { authorizeCron } from "@/lib/cron-auth";
import { liveTollfreeDeps } from "@/lib/tollfree/deps";
import { pollTollfree } from "@/lib/tollfree/service";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Daily backstop for the Event Streams webhook: re-check every pending verification. */
export async function GET(req: Request): Promise<Response> {
  const denied = authorizeCron(req, "tollfree-status");
  if (denied) return denied;
  return Response.json({ ok: true, ...(await pollTollfree(liveTollfreeDeps())) });
}
