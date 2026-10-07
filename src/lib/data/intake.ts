import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeItems, services, users } from "@/db/schema";

/** Services + FAQs a business already has (what a website draft would add to). */
export async function countDraftableContent(clientId: string): Promise<number> {
  const [svc] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(services)
    .where(and(eq(services.clientId, clientId), isNull(services.deletedAt)));
  const [kb] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.clientId, clientId), isNull(knowledgeItems.deletedAt)));
  return (svc?.n ?? 0) + (kb?.n ?? 0);
}

/**
 * Has anyone from this business signed in to its portal yet?
 *
 * The intake link is a bearer credential — whoever holds it can change the
 * business's name, contact details and what its AI says — and it lasts 30
 * days. Once the owner has an account, the portal is the place for edits and
 * the link has done its job, so it locks (the page sends them to sign in).
 * A portal user row is created on first sign-in, so its existence is the
 * signal; no extra column needed.
 */
export async function ownerHasSignedIn(clientId: string): Promise<boolean> {
  const row = await db.query.users.findFirst({
    where: and(
      eq(users.clientId, clientId),
      inArray(users.role, ["client_admin", "client_viewer"]),
      isNull(users.deletedAt),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}
