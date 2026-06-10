import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Authenticate a Retell agent-tool callback. The tool URLs are provisioned with
 * `?client=<id>&token=<secret>`; we verify the shared secret (timing-safe) and
 * return the client id. These endpoints are public to Clerk (machine callers).
 */
export function authenticateAgentTool(
  url: URL,
): { ok: true; clientId: string } | { ok: false; status: number; message: string } {
  const token = url.searchParams.get("token") ?? "";
  const clientId = url.searchParams.get("client") ?? "";

  const expected = env.AGENT_TOOLS_SECRET;
  // Reject empty token/secret outright — never let an empty match authenticate.
  if (!token || !expected) return { ok: false, status: 401, message: "Invalid token" };
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && timingSafeEqual(a, b);

  if (!valid) return { ok: false, status: 401, message: "Invalid token" };
  if (!clientId) return { ok: false, status: 400, message: "Missing client" };
  return { ok: true, clientId };
}

/** Read function args from a Retell tool POST (args may be nested or at root). */
export async function readToolArgs(req: Request): Promise<{ args: Record<string, unknown>; retellCallId?: string }> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const args = (body.args ?? body) as Record<string, unknown>;
  const call = body.call as { call_id?: string } | undefined;
  return { args, retellCallId: call?.call_id };
}
