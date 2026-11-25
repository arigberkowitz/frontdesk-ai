import "server-only";

import { checkBotId } from "botid/server";
import { logger } from "@/lib/logger";
import { BOT_BLOCKED_MESSAGE, BOTID_CHECK_LEVEL } from "@/lib/botid-protect";

export { BOT_BLOCKED_MESSAGE };

export type PublicBotCheck = { isBot: false } | { isBot: true; message: string };

type DevBypass = "HUMAN" | "BAD-BOT" | "GOOD-BOT";

function devBypass(): DevBypass | undefined {
  const raw = process.env.BOTID_DEV_BYPASS;
  if (raw === "HUMAN" || raw === "BAD-BOT" || raw === "GOOD-BOT") return raw;
  return undefined;
}

/**
 * Basic BotID check for public forms.
 *
 * Official `checkBotId()` already fail-opens when NODE_ENV !== "production"
 * (returns isBot: false, and treats NODE_ENV=test the same as development).
 * We short-circuit that case ourselves so unit tests don't print the
 * package's "[Dev Only]" warning on every assertion. Set BOTID_DEV_BYPASS
 * (HUMAN | BAD-BOT | GOOD-BOT) to exercise the other branches locally —
 * that option is ignored in production.
 *
 * A thrown check fail-opens and is logged: a BotID outage shouldn't take
 * down the contact form or a client's intake link.
 */
export async function checkPublicBot(): Promise<PublicBotCheck> {
  const bypass = devBypass();
  const inProduction = process.env.NODE_ENV === "production";
  if (!inProduction && !bypass) return { isBot: false };

  try {
    const verification = await checkBotId({
      advancedOptions: { checkLevel: BOTID_CHECK_LEVEL },
      developmentOptions: bypass ? { bypass } : undefined,
    });
    if (verification.isBot) {
      logger.warn("botid.blocked");
      return { isBot: true, message: BOT_BLOCKED_MESSAGE };
    }
    return { isBot: false };
  } catch (err) {
    logger.error("botid.check_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { isBot: false };
  }
}

/** JSON 403 for a public API route. Unused today — kept for the next one. */
export function botForbiddenResponse(): Response {
  return Response.json({ error: BOT_BLOCKED_MESSAGE }, { status: 403 });
}
