import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* ============================================================================
 * FrontDesk AI — data model (PRD §6)
 *
 * Conventions:
 *  - UUID primary keys (defaultRandom)
 *  - created_at / updated_at on every table; updated_at auto-bumps
 *  - deleted_at (soft delete) where losing data would hurt
 *  - Money stored as integer *cents* (column names suffixed *_cents)
 *  - Every tenant-owned row carries client_id; queries must scope by it (§12)
 * ========================================================================== */

/* ----------------------------------- helpers ----------------------------- */
const pk = () => uuid("id").primaryKey().defaultRandom();

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/* ------------------------------------ enums ------------------------------ */
export const userRole = pgEnum("user_role", ["operator", "client_viewer"]);
export const clientStatus = pgEnum("client_status", [
  "draft",
  "trial",
  "live",
  "paused",
  "churned",
]);
export const knowledgeSource = pgEnum("knowledge_source", ["scraped", "manual"]);
export const callDirection = pgEnum("call_direction", ["inbound", "outbound"]);
export const callOutcome = pgEnum("call_outcome", [
  "booked",
  "lead",
  "faq_answered",
  "escalated",
  "spam",
  "missed",
  "other",
]);
export const callSentiment = pgEnum("call_sentiment", [
  "positive",
  "neutral",
  "negative",
  "unknown",
]);
export const appointmentStatus = pgEnum("appointment_status", [
  "booked",
  "confirmed",
  "cancelled",
  "no_show",
]);
export const leadStatus = pgEnum("lead_status", ["new", "contacted", "won", "lost"]);
export const reminderChannel = pgEnum("reminder_channel", ["call", "sms"]);
export const reminderStatus = pgEnum("reminder_status", ["queued", "sent", "failed"]);
export const notificationChannel = pgEnum("notification_channel", ["email", "sms"]);
export const notificationType = pgEnum("notification_type", [
  "booking",
  "lead",
  "digest_daily",
  "digest_weekly",
  "system",
]);
export const notificationStatus = pgEnum("notification_status", ["queued", "sent", "failed"]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "paused",
  "incomplete",
]);
export const webhookSource = pgEnum("webhook_source", ["retell", "stripe", "cal"]);
export const webhookStatus = pgEnum("webhook_status", [
  "received",
  "processed",
  "failed",
  "ignored",
]);

/* ----------------------------------- tables ------------------------------ */

/** A company workspace. Self-serve signups create one; teammates with the same
 *  company email domain share it. */
export const organizations = pgTable(
  "organizations",
  {
    id: pk(),
    name: text("name").notNull(),
    // 'agency' = manages many client businesses with the full admin; 'business' =
    // a self-serve company that manages its own business(es) via the simpler portal.
    kind: text("kind").notNull().default("business"),
    // Company email domain that owns this workspace (e.g. "acme.com"), so two
    // @acme.com employees share it. Null = a personal / free-email workspace,
    // which is never grouped by domain.
    domain: text("domain"),
    ...timestamps,
  },
  (t) => [uniqueIndex("organizations_domain_idx").on(t.domain)],
);

/** A client business — the unit of tenancy. */
export const clients = pgTable(
  "clients",
  {
    id: pk(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    industry: text("industry"),
    address: text("address"),
    timezone: text("timezone").notNull().default("America/Los_Angeles"),
    status: clientStatus("status").notNull().default("draft"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    retellAgentId: text("retell_agent_id"),
    retellLlmId: text("retell_llm_id"),
    retellPhoneNumber: text("retell_phone_number"),
    forwardingNumber: text("forwarding_number"),
    escalationNumber: text("escalation_number"),
    // Owner's email for booking / message alerts (Resend).
    ownerEmail: text("owner_email"),
    voiceId: text("voice_id"),
    // What the receptionist calls itself (e.g. "Riley"). Null → DEFAULT_AGENT_NAME.
    agentName: text("agent_name"),
    greeting: text("greeting"),
    // Company-authored agent guardrails ("what it may say") + booking rules.
    agentGuidance: text("agent_guidance"),
    bookingInstructions: text("booking_instructions"),
    // Per-business calendar connection — bookings land on each client's own calendar.
    calendarProvider: text("calendar_provider"), // 'calcom' | 'google'
    calendarAccount: text("calendar_account"), // connected email / label, for display
    calendarId: text("calendar_id"), // cal.com eventTypeId or google calendarId
    calendarSecret: text("calendar_secret"), // encrypted (api key or refresh token)
    calendarConnectedAt: timestamp("calendar_connected_at", { withTimezone: true }),
    // §12 recording/AI disclosure toggle (default-on) + optional custom line.
    recordingDisclosureEnabled: boolean("recording_disclosure_enabled").notNull().default(true),
    recordingDisclosureLine: text("recording_disclosure_line"),
    // "Human touch": when on, the AI proactively offers to connect callers to a
    // real person (and always promises a callback if no one's free). The note
    // tells the AI when a human is actually reachable, e.g. "weekdays 9–5".
    humanHandoffEnabled: boolean("human_handoff_enabled").notNull().default(true),
    humanHoursNote: text("human_hours_note"),
    // Spoken languages the AI handles: 'en' | 'en-es' (bilingual) | 'es'.
    // Drives the agent's language behavior (match the caller, switch on request).
    languages: text("languages").notNull().default("en"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("clients_org_id_idx").on(t.orgId), index("clients_status_idx").on(t.status)],
);

/** Operators and scoped client viewers. Mirrors a Clerk user. */
export const users = pgTable(
  "users",
  {
    id: pk(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id"),
    email: text("email").notNull(),
    role: userRole("role").notNull().default("operator"),
    // client_viewer rows are scoped to exactly one client; operators leave null.
    clientId: uuid("client_id").references((): AnyPgColumn => clients.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("users_clerk_user_id_idx").on(t.clerkUserId),
    index("users_org_id_idx").on(t.orgId),
    index("users_client_id_idx").on(t.clientId),
  ],
);

/** FAQ / knowledge entries the agent answers from. */
export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    source: knowledgeSource("source").notNull().default("manual"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("knowledge_items_client_id_idx").on(t.clientId)],
);

/** Bookable services. */
export const services = pgTable(
  "services",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMin: integer("duration_min").notNull().default(30),
    priceCents: integer("price_cents"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("services_client_id_idx").on(t.clientId)],
);

/** Weekly business hours; drives `is_after_hours` classification. */
export const businessHours = pgTable(
  "business_hours",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday … 6 = Saturday
    openTime: text("open_time"), // "09:00" (client-local)
    closeTime: text("close_time"), // "17:00"
    isClosed: boolean("is_closed").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("business_hours_client_id_idx").on(t.clientId),
    uniqueIndex("business_hours_client_day_idx").on(t.clientId, t.dayOfWeek),
  ],
);

/** One row per call. `retell_call_id` is the idempotency key for webhook upserts. */
export const calls = pgTable(
  "calls",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    retellCallId: text("retell_call_id"),
    direction: callDirection("direction").notNull().default("inbound"),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    recordingUrl: text("recording_url"),
    transcript: text("transcript"),
    summary: text("summary"),
    sentiment: callSentiment("sentiment"),
    outcome: callOutcome("outcome"),
    isAfterHours: boolean("is_after_hours").notNull().default(false),
    confidenceFlag: boolean("confidence_flag").notNull().default(false),
    retellCostCents: integer("retell_cost_cents"),
    rawPayload: jsonb("raw_payload"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("calls_retell_call_id_idx").on(t.retellCallId),
    index("calls_client_id_start_at_idx").on(t.clientId, t.startAt),
    index("calls_outcome_idx").on(t.outcome),
  ],
);

/** Appointments booked during calls (and pushed to the booking provider). */
export const appointments = pgTable(
  "appointments",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    status: appointmentStatus("status").notNull().default("booked"),
    externalBookingId: text("external_booking_id"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index("appointments_client_id_start_at_idx").on(t.clientId, t.startAt),
    index("appointments_call_id_idx").on(t.callId),
  ],
);

/** Captured non-booking leads (messages). */
export const leads = pgTable(
  "leads",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    name: text("name"),
    phone: text("phone"),
    reason: text("reason"),
    message: text("message"),
    status: leadStatus("status").notNull().default("new"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("leads_client_id_idx").on(t.clientId)],
);

/** Appointment reminder log: one row per call/text reminder a business sends a
 *  customer about an upcoming appointment, so the portal can show exactly when
 *  each customer was pinged (and whether it went through). */
export const reminders = pgTable(
  "reminders",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    channel: reminderChannel("channel").notNull(),
    status: reminderStatus("status").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    index("reminders_client_id_idx").on(t.clientId),
    index("reminders_appointment_id_idx").on(t.appointmentId),
  ],
);

/** Outbound notification log (`recipient` instead of reserved word `to`). */
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    channel: notificationChannel("channel").notNull(),
    recipient: text("recipient").notNull(),
    payload: jsonb("payload"),
    status: notificationStatus("status").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("notifications_client_id_idx").on(t.clientId)],
);

/** Stripe subscription mirror (one active per client). */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    plan: text("plan"),
    monthlyPriceCents: integer("monthly_price_cents"),
    setupFeeCents: integer("setup_fee_cents"),
    status: subscriptionStatus("status"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("subscriptions_client_id_idx").on(t.clientId),
    index("subscriptions_stripe_customer_idx").on(t.stripeCustomerId),
  ],
);

/** Prompt iteration history ("it improves"). */
export const agentVersions = pgTable(
  "agent_versions",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    promptSnapshot: text("prompt_snapshot").notNull(),
    knowledgeSnapshot: jsonb("knowledge_snapshot"),
    publishedBy: uuid("published_by").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("agent_versions_client_id_idx").on(t.clientId),
    uniqueIndex("agent_versions_client_version_idx").on(t.clientId, t.version),
  ],
);

/** Webhook idempotency + audit. Unique (source, external_id) dedupes replays. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: pk(),
    source: webhookSource("source").notNull(),
    externalId: text("external_id"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload"),
    status: webhookStatus("status").notNull().default("received"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("webhook_events_source_external_idx").on(t.source, t.externalId),
    index("webhook_events_status_idx").on(t.status),
  ],
);

/* --------------------------------- relations ----------------------------- */
export const organizationsRelations = relations(organizations, ({ many }) => ({
  clients: many(clients),
  users: many(users),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.orgId],
    references: [organizations.id],
  }),
  viewers: many(users),
  knowledgeItems: many(knowledgeItems),
  services: many(services),
  businessHours: many(businessHours),
  calls: many(calls),
  appointments: many(appointments),
  leads: many(leads),
  reminders: many(reminders),
  notifications: many(notifications),
  subscription: one(subscriptions),
  agentVersions: many(agentVersions),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, { fields: [users.orgId], references: [organizations.id] }),
  client: one(clients, { fields: [users.clientId], references: [clients.id] }),
}));

export const knowledgeItemsRelations = relations(knowledgeItems, ({ one }) => ({
  client: one(clients, { fields: [knowledgeItems.clientId], references: [clients.id] }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  client: one(clients, { fields: [services.clientId], references: [clients.id] }),
  appointments: many(appointments),
}));

export const businessHoursRelations = relations(businessHours, ({ one }) => ({
  client: one(clients, { fields: [businessHours.clientId], references: [clients.id] }),
}));

export const callsRelations = relations(calls, ({ one, many }) => ({
  client: one(clients, { fields: [calls.clientId], references: [clients.id] }),
  appointments: many(appointments),
  leads: many(leads),
}));

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  client: one(clients, { fields: [appointments.clientId], references: [clients.id] }),
  call: one(calls, { fields: [appointments.callId], references: [calls.id] }),
  service: one(services, { fields: [appointments.serviceId], references: [services.id] }),
  reminders: many(reminders),
}));

export const remindersRelations = relations(reminders, ({ one }) => ({
  client: one(clients, { fields: [reminders.clientId], references: [clients.id] }),
  appointment: one(appointments, {
    fields: [reminders.appointmentId],
    references: [appointments.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  client: one(clients, { fields: [leads.clientId], references: [clients.id] }),
  call: one(calls, { fields: [leads.callId], references: [calls.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  client: one(clients, { fields: [subscriptions.clientId], references: [clients.id] }),
}));

export const agentVersionsRelations = relations(agentVersions, ({ one }) => ({
  client: one(clients, { fields: [agentVersions.clientId], references: [clients.id] }),
  publisher: one(users, { fields: [agentVersions.publishedBy], references: [users.id] }),
}));

/* ----------------------------- inferred types ---------------------------- */
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type NewKnowledgeItem = typeof knowledgeItems.$inferInsert;
export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type BusinessHour = typeof businessHours.$inferSelect;
export type NewBusinessHour = typeof businessHours.$inferInsert;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type AgentVersion = typeof agentVersions.$inferSelect;
export type NewAgentVersion = typeof agentVersions.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

export type ClientStatus = (typeof clientStatus.enumValues)[number];
export type CallOutcome = (typeof callOutcome.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
