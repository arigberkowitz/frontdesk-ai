import "server-only";
import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, organizations, subscriptions } from "@/db/schema";

/**
 * Platform-owner oversight queries. These deliberately span ALL workspaces (not
 * org-scoped) and must only ever be called behind `requireSuperAdmin()`.
 */

export interface PlatformWorkspace {
  orgId: string;
  name: string;
  kind: string;
  domain: string | null;
  createdAt: Date;
  members: number;
  businesses: { id: string; name: string; status: string }[];
}

/** Every workspace on the platform, newest first, with its businesses + member count. */
export async function listAllWorkspaces(): Promise<PlatformWorkspace[]> {
  const orgs = await db.query.organizations.findMany({
    orderBy: [desc(organizations.createdAt)],
    with: {
      clients: { where: (c, { isNull }) => isNull(c.deletedAt) },
      users: true,
    },
  });
  return orgs
    // A workspace with no members is an orphan (e.g. a leftover from a first-login
    // race) — it represents no real account, so never surface it here.
    .filter((o) => o.users.length > 0)
    .map((o) => ({
      orgId: o.id,
      name: o.name,
      kind: o.kind,
      domain: o.domain,
      createdAt: o.createdAt,
      members: o.users.length,
      businesses: o.clients.map((c) => ({ id: c.id, name: c.name, status: c.status })),
    }));
}

export interface DeletedBusiness {
  id: string;
  name: string;
  deletedAt: Date;
  /** Vendor things our database still points at (a deleted business should hold none). */
  holds: string[];
}

/** Businesses hidden from every list but not yet purged (closed by the owner, or deleted by an operator). Super-admin only. */
export async function listDeletedBusinesses(): Promise<DeletedBusiness[]> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      deletedAt: clients.deletedAt,
      agent: clients.retellAgentId,
      llm: clients.retellLlmId,
      phone: clients.retellPhoneNumber,
      calendar: clients.calendarProvider,
      subId: subscriptions.stripeSubscriptionId,
      subStatus: subscriptions.status,
    })
    .from(clients)
    .leftJoin(subscriptions, eq(subscriptions.clientId, clients.id))
    .where(isNotNull(clients.deletedAt))
    .orderBy(desc(clients.deletedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    deletedAt: r.deletedAt as Date,
    holds: [
      r.phone && "phone number",
      r.agent && "AI agent",
      r.llm && "LLM",
      r.calendar && "calendar token",
      r.subId && r.subStatus !== "canceled" && "subscription not canceled",
    ].filter((x): x is string => Boolean(x)),
  }));
}
