import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, type Client, type ClientStatus, type NewClient } from "@/db/schema";

/**
 * Client data access. Every function is scoped by `orgId` so an operator can
 * only ever touch their own agency's clients (§12 tenant isolation).
 */

export async function listClients(orgId: string): Promise<Client[]> {
  return db.query.clients.findMany({
    where: and(eq(clients.orgId, orgId), isNull(clients.deletedAt)),
    orderBy: [desc(clients.createdAt)],
  });
}

export async function getClient(orgId: string, clientId: string) {
  return db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.orgId, orgId), isNull(clients.deletedAt)),
    with: {
      services: {
        where: (s, { isNull: n }) => n(s.deletedAt),
        orderBy: (s, { asc }) => [asc(s.name)],
      },
      providers: {
        where: (p, { isNull: n }) => n(p.deletedAt),
        orderBy: (p, { asc }) => [asc(p.name)],
      },
      businessHours: { orderBy: (h, { asc }) => [asc(h.dayOfWeek)] },
      knowledgeItems: {
        where: (k, { isNull: n }) => n(k.deletedAt),
        orderBy: (k, { desc: d }) => [d(k.createdAt)],
      },
    },
  });
}

export type ClientWithRelations = NonNullable<Awaited<ReturnType<typeof getClient>>>;

/** Look up a client by its Retell agent id (webhook context — not org-scoped). */
export async function getClientByRetellAgentId(agentId: string) {
  return db.query.clients.findFirst({
    where: and(eq(clients.retellAgentId, agentId), isNull(clients.deletedAt)),
    with: {
      businessHours: { orderBy: (h, { asc }) => [asc(h.dayOfWeek)] },
      services: { where: (s, { isNull: n }) => n(s.deletedAt) },
    },
  });
}

/**
 * Fetch a client by id WITHOUT org scoping — only for machine endpoints already
 * authenticated by a shared secret (agent-tool callbacks). Includes services +
 * hours needed to resolve bookings.
 */
export async function getClientByIdUnsafe(clientId: string) {
  return db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    with: {
      businessHours: { orderBy: (h, { asc }) => [asc(h.dayOfWeek)] },
      services: { where: (s, { isNull: n }) => n(s.deletedAt) },
    },
  });
}

/** Throw unless the client exists and belongs to the org. Returns the row. */
export async function assertClientInOrg(orgId: string, clientId: string): Promise<Client> {
  const row = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.orgId, orgId), isNull(clients.deletedAt)),
  });
  if (!row) throw new Error("Client not found");
  return row;
}

export async function createClient(
  orgId: string,
  input: Pick<
    NewClient,
    "name" | "websiteUrl" | "industry" | "address" | "timezone" | "companySize" | "staffModeEnabled"
  >,
): Promise<Client> {
  const [row] = await db.insert(clients).values({ ...input, orgId }).returning();
  if (!row) throw new Error("Failed to create client");
  return row;
}

export async function updateClient(
  orgId: string,
  clientId: string,
  patch: Partial<NewClient>,
): Promise<Client> {
  const [row] = await db
    .update(clients)
    .set(patch)
    .where(and(eq(clients.id, clientId), eq(clients.orgId, orgId), isNull(clients.deletedAt)))
    .returning();
  if (!row) throw new Error("Client not found");
  return row;
}

export async function setClientStatus(
  orgId: string,
  clientId: string,
  status: ClientStatus,
): Promise<Client> {
  return updateClient(orgId, clientId, { status });
}

export async function softDeleteClient(orgId: string, clientId: string): Promise<void> {
  await db
    .update(clients)
    .set({ deletedAt: new Date() })
    .where(and(eq(clients.id, clientId), eq(clients.orgId, orgId)));
}

/**
 * Which business did this person last hear from?
 *
 * `findClientByPhone` below matches the number the customer texted against each
 * business's own line, which is the right signal — when each business has its
 * own line. Every outbound text actually leaves from one shared sending number,
 * so that match never succeeded and every reply was dropped on the floor with a
 * log line and nothing else. Ask a customer to "reply YES to confirm" and their
 * YES went nowhere at all.
 *
 * The fallback is the last business that texted them, which keeps the property
 * that mattered in the original: the same consumer can be a lead at a dentist
 * and at a plumber, and their reply has to reach the one they were talking to —
 * not both, and not the wrong one.
 */
export async function findClientLastTexted(phone: string) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return null;
  const rows = await db.execute(sql`
    select r.client_id
    from reminders r
    left join leads l on l.id = r.lead_id
    left join appointments a on a.id = r.appointment_id
    where r.status = 'sent'
      and (
        regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') like ${"%" + digits}
        or regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g') like ${"%" + digits}
      )
    order by r.created_at desc
    limit 1
  `);
  const clientId = (rows as unknown as Array<{ client_id?: string }>)[0]?.client_id;
  return clientId ? getClientByIdUnsafe(clientId) : null;
}

/**
 * Which business owns an inbound number.
 *
 * Used by the Twilio webhook to attribute a reply to the tenant the customer
 * actually texted, rather than searching every lead on the platform and hoping.
 * Matches on the last 10 digits so stored formatting (+1, dashes, parens)
 * doesn't decide the answer.
 */
export async function findClientByPhone(phone: string) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return null;
  return (
    (await db.query.clients.findFirst({
      where: (c, { and: a, isNull: n, sql: s }) =>
        a(
          n(c.deletedAt),
          s`regexp_replace(coalesce(${c.retellPhoneNumber}, ''), '[^0-9]', '', 'g') like ${"%" + digits}`,
        ),
    })) ?? null
  );
}
