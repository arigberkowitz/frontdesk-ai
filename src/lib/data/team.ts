import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users, type User, type UserRole } from "@/db/schema";

/**
 * A business's portal members: every live `users` row attached to the client
 * (`client_admin` = owner, `client_viewer` = staff). Agency operators aren't
 * members of a single business, so they're not listed.
 */
export async function listTeamMembers(clientId: string): Promise<User[]> {
  return db
    .select()
    .from(users)
    .where(and(eq(users.clientId, clientId), isNull(users.deletedAt)))
    .orderBy(asc(users.createdAt));
}

/** One member, only if they belong to this client (the tenant check). */
export async function getTeamMember(clientId: string, userId: string): Promise<User | null> {
  const row = (
    await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.clientId, clientId), isNull(users.deletedAt)))
      .limit(1)
  )[0];
  return row ?? null;
}

export async function countOwners(clientId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.clientId, clientId), eq(users.role, "client_admin"), isNull(users.deletedAt)),
    );
  return rows.length;
}

export async function setMemberRole(
  clientId: string,
  userId: string,
  role: Extract<UserRole, "client_admin" | "client_viewer">,
): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.clientId, clientId), isNull(users.deletedAt)))
    .returning({ id: users.id });
  return updated.length > 0;
}

/**
 * Soft-remove a member. `clerk_user_id` is cleared too: it's uniquely indexed,
 * so leaving it would block that person's Clerk account from ever getting a
 * fresh row (e.g. re-invited later, or signing up for their own business).
 */
export async function removeMember(clientId: string, userId: string): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ deletedAt: new Date(), clerkUserId: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.clientId, clientId), isNull(users.deletedAt)))
    .returning({ id: users.id });
  return updated.length > 0;
}
