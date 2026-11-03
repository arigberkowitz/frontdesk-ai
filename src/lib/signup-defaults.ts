import { toE164 } from "@/lib/format";

/**
 * What a self-serve signup turns on beyond the trial itself.
 *
 * The homepage and the pricing cards sell missed-call text-back and AI text
 * replies as part of the product, so they start ON for a new business (the
 * owner can switch either off). The AI phone call-back switch also starts on;
 * it only does anything once the platform turns AI call-backs on.
 *
 * Review requests, recall, smart rebooking and outbound recovery are NOT
 * advertised as automatic and stay off until the owner opts in.
 *
 * The owner's cell, when given, becomes the live-transfer number — so a caller
 * who asks for a person can actually reach one.
 */
export function signupDefaults(ownerCell: string | null | undefined) {
  const cell = toE164(ownerCell ?? null);
  return {
    missedCallTextsEnabled: true,
    aiTextRepliesEnabled: true,
    missedCallAiCallbacksEnabled: true,
    ...(cell ? { escalationNumber: cell } : {}),
  };
}

/** Optional cell from a signup form: "" → null, unparseable → "invalid". */
export function parseOwnerCell(raw: unknown): string | null | "invalid" {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return toE164(s) ?? "invalid";
}
