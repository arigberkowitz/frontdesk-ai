import { z } from "zod";
import type { Actor, ControlDeps, ControlResult } from "./controls";
import { deleteAgent, deleteCompany, reactivateCompany, releaseNumber, releaseVoiceNumber, suspendCompany } from "./controls";
import { deleteOrphan, listOrphans, type OrphanProviders, type OrphanReport, type OrphanStore } from "./orphans";
import type { AccessDecision } from "./access";

/**
 * Request handling for the operator routes, with auth and the vendors injected
 * so the 403 / validation / error paths are tested without Next or a session.
 * The route files are thin wrappers that pass the live pieces in.
 */

export type Authorize = (
  scope: "client" | "platform",
  clientId: string | null,
) => Promise<{ decision: AccessDecision; actor?: Actor }>;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("release_number") }),
  z.object({ action: z.literal("release_voice_number") }),
  z.object({ action: z.literal("delete_agent") }),
  z.object({
    action: z.literal("suspend"),
    mode: z.enum(["off", "messages_only"]).default("off"),
    stripe: z.enum(["cancel", "pause", "none"]).default("cancel"),
    prorate: z.boolean().optional(),
    reason: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal("reactivate") }),
  z.object({
    action: z.literal("delete_company"),
    confirm: z.string().max(200),
    blockFraud: z.boolean().default(false),
    reason: z.string().max(300).optional(),
  }),
]);

const orphanBody = z.object({
  kind: z.enum(["retell_agent", "retell_llm", "retell_number", "twilio_number", "stripe_subscription"]),
  id: z.string().min(1).max(200),
});

function isJson(req: Request): boolean {
  // A cross-site <form> can't send application/json without a CORS preflight,
  // so requiring it closes the CSRF door on these destructive POSTs.
  return (req.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

const deny = (d: Extract<AccessDecision, { ok: false }>) =>
  Response.json({ ok: false, message: d.error }, { status: d.status });

export async function handleClientControl(
  req: Request,
  clientId: string,
  ctx: { authorize: Authorize; deps: () => ControlDeps },
): Promise<Response> {
  const { decision, actor } = await ctx.authorize("client", clientId);
  if (!decision.ok) return deny(decision);
  if (!actor) return Response.json({ ok: false, message: "Sign in required." }, { status: 401 });
  if (!isJson(req)) return Response.json({ ok: false, message: "Send JSON." }, { status: 415 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Bad request." }, { status: 400 });
  const deps = ctx.deps();
  const b = parsed.data;
  let result: ControlResult;
  switch (b.action) {
    case "release_number":
      result = await releaseNumber(deps, actor, clientId);
      break;
    case "release_voice_number":
      result = await releaseVoiceNumber(deps, actor, clientId);
      break;
    case "delete_agent":
      result = await deleteAgent(deps, actor, clientId);
      break;
    case "suspend":
      result = await suspendCompany(deps, actor, clientId, b);
      break;
    case "reactivate":
      result = await reactivateCompany(deps, actor, clientId);
      break;
    case "delete_company":
      result = await deleteCompany(deps, actor, clientId, b);
      break;
  }
  return Response.json(result, { status: result.httpStatus });
}

type OrphanCtx = { authorize: Authorize; deps: () => { providers: OrphanProviders; store: OrphanStore } };

export async function handleOrphansList(ctx: OrphanCtx): Promise<Response> {
  const { decision } = await ctx.authorize("platform", null);
  if (!decision.ok) return deny(decision);
  const report: OrphanReport = await listOrphans(ctx.deps());
  return Response.json(report);
}

export async function handleOrphanDelete(req: Request, ctx: OrphanCtx): Promise<Response> {
  const { decision, actor } = await ctx.authorize("platform", null);
  if (!decision.ok) return deny(decision);
  if (!actor) return Response.json({ ok: false, message: "Sign in required." }, { status: 401 });
  if (!isJson(req)) return Response.json({ ok: false, message: "Send JSON." }, { status: 415 });
  const parsed = orphanBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Bad request." }, { status: 400 });
  const res = await deleteOrphan(ctx.deps(), actor, parsed.data);
  return Response.json(res, { status: res.httpStatus });
}
