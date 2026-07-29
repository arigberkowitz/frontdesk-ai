"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, organizations, users } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth-guard";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * Adopt an isolated self-serve workspace into the platform agency: its
 * business(es) become agency clients (visible under /clients), and its members
 * become client_admins of their own business — they keep exactly the portal
 * they had, the operator gains oversight. The emptied workspace is removed.
 * Exists for accounts created before auto-attach signups (and for any created
 * while the operator has auto-attach switched off).
 */
export async function adoptWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireSuperAdmin();
  const orgId = String(formData.get("orgId") ?? "");
  if (!orgId) return { ok: false, error: "Missing workspace." };
  if (orgId === admin.orgId) return { ok: false, error: "That's already your agency." };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    with: {
      clients: { where: (c, { isNull: nil }) => nil(c.deletedAt) },
      users: true,
    },
  });
  if (!org) return { ok: false, error: "Workspace not found." };
  if (org.kind === "agency") return { ok: false, error: "Can't adopt another agency." };

  const primaryClientId = org.clients[0]?.id ?? null;

  await db.transaction(async (tx) => {
    // Businesses move under the agency.
    await tx
      .update(clients)
      .set({ orgId: admin.orgId })
      .where(and(eq(clients.orgId, orgId), isNull(clients.deletedAt)));

    // Members become client_admins of their business (keep an explicit
    // client_viewer as-is; never import an operator role into the agency).
    for (const member of org.users) {
      await tx
        .update(users)
        .set({
          orgId: admin.orgId,
          role: member.role === "client_viewer" ? "client_viewer" : "client_admin",
          clientId: member.clientId ?? primaryClientId,
        })
        .where(eq(users.id, member.id));
    }

    // The emptied workspace disappears from Platform. (Members were moved out
    // first, so the users FK cascade has nothing left to touch.)
    await tx.delete(organizations).where(eq(organizations.id, orgId));
  });

  logger.info("platform.workspace_adopted", {
    orgId,
    intoOrg: admin.orgId,
    clientsMoved: org.clients.length,
    membersMoved: org.users.length,
  });
  revalidatePath("/platform");
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: `Adopted "${org.name}" — ${org.clients.length === 1 ? "its business now appears" : `${org.clients.length} businesses now appear`} under Clients, and its ${org.users.length === 1 ? "member keeps" : "members keep"} the same portal.`,
  };
}
