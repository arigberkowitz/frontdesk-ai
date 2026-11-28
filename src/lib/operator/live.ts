import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, organizations } from "@/db/schema";
import { getCurrentDbUserSafe, isSuperAdmin } from "@/lib/auth-guard";
import { decideOperatorAccess } from "./access";
import type { Authorize } from "./handler";
import { liveProviders } from "./providers";
import { liveStore } from "./store";
import type { ControlDeps } from "./controls";

/** Live wiring for the operator routes: the real session check, vendors and database. */
export const liveAuthorize: Authorize = async (scope, clientId) => {
  const user = await getCurrentDbUserSafe();
  if (!user) {
    return { decision: decideOperatorAccess({ user: null, superAdmin: false, orgKind: null, targetOrgId: null }, scope) };
  }
  const [org] = await db.select({ kind: organizations.kind }).from(organizations).where(eq(organizations.id, user.orgId)).limit(1);
  let targetOrgId: string | null = null;
  if (scope === "client" && clientId) {
    const [c] = await db.select({ orgId: clients.orgId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    targetOrgId = c?.orgId ?? null;
  }
  const decision = decideOperatorAccess(
    { user: { role: user.role, orgId: user.orgId }, superAdmin: isSuperAdmin(user), orgKind: org?.kind ?? null, targetOrgId },
    scope,
  );
  return { decision, actor: { id: user.id, email: user.email } };
};

export const liveControlDeps = (): ControlDeps => ({ providers: liveProviders(), store: liveStore() });
export const liveOrphanDeps = () => ({ providers: liveProviders(), store: liveStore() });
