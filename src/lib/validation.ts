import { z } from "zod";

/**
 * Input schemas for operator mutations. Validated server-side in each Server
 * Action; money fields are entered in dollars and converted to cents at the
 * data layer.
 */

const optionalUrl = z
  .string()
  .trim()
  .url("Enter a valid URL (including https://)")
  .optional()
  .or(z.literal(""));

const optionalString = z.string().trim().max(2000).optional().or(z.literal(""));

export const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(120),
  websiteUrl: optionalUrl,
  industry: optionalString,
  address: optionalString,
  timezone: z.string().trim().min(1).default("America/Los_Angeles"),
});
export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

export const clientProfileSchema = clientCreateSchema.extend({
  escalationNumber: optionalString,
  forwardingNumber: optionalString,
  ownerEmail: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(1, "Service name is required").max(120),
  durationMin: z.coerce.number().int().min(5).max(480).default(30),
  // Entered in dollars; converted to cents by the action.
  priceDollars: z.coerce.number().min(0).max(100000).optional(),
  // How many staff can perform this service at once (1 = no overlapping slots).
  providerCount: z.coerce.number().int().min(1).max(50).default(1),
  description: optionalString,
  // Bookable by video: Google/Microsoft calendars attach a Meet/Teams link.
  virtualOk: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});
export type ServiceInput = z.infer<typeof serviceSchema>;

export const knowledgeSchema = z.object({
  question: z.string().trim().min(1, "Question is required").max(500),
  answer: z.string().trim().min(1, "Answer is required").max(4000),
  isActive: z.coerce.boolean().default(true),
});
export type KnowledgeInput = z.infer<typeof knowledgeSchema>;

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
export const hoursDaySchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  isClosed: z.coerce.boolean().default(false),
  openTime: z.string().regex(timeRegex, "Use HH:MM").optional().or(z.literal("")),
  closeTime: z.string().regex(timeRegex, "Use HH:MM").optional().or(z.literal("")),
});

/** Company-authored guardrails: what the AI may say + how it should book. */
export const guidelinesSchema = z.object({
  greeting: z.string().trim().max(1000).optional().or(z.literal("")),
  agentGuidance: z.string().trim().max(4000).optional().or(z.literal("")),
  bookingInstructions: z.string().trim().max(4000).optional().or(z.literal("")),
});
export type GuidelinesInput = z.infer<typeof guidelinesSchema>;

export const agentConfigSchema = z.object({
  greeting: z.string().trim().max(1000).optional().or(z.literal("")),
  agentName: z.string().trim().max(60).optional().or(z.literal("")),
  voiceId: z.string().trim().max(120).optional().or(z.literal("")),
  escalationNumber: optionalString,
  boostedKeywords: z.string().trim().max(1000).optional().or(z.literal("")),
  recordingDisclosureEnabled: z.coerce.boolean().default(true),
  recordingDisclosureLine: z.string().trim().max(500).optional().or(z.literal("")),
  agentGuidance: z.string().trim().max(4000).optional().or(z.literal("")),
  bookingInstructions: z.string().trim().max(4000).optional().or(z.literal("")),
});

/** Normalize an empty string to null for nullable DB columns. */
export function emptyToNull(v: string | undefined | null): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}
