import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";

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
