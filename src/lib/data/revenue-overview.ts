import "server-only";
import type { Client } from "@/db/schema";
import { planAccessFor, type RevenueFeature } from "@/lib/plan-access";
import { revenueTextStats } from "@/lib/data/revenue-texts";
import { quoteTeaserFor, winbackTeaserFor, type Teaser } from "@/lib/data/revenue-teasers";
import { getQuoteFollowupStats } from "@/lib/revenue/quote-followup-data";
import { parseSettings as parseQuoteSettings } from "@/lib/revenue/quote-followup";
import { statsLine } from "@/lib/revenue-texts";
import { winbackSettingsOf } from "@/lib/winback";

/**
 * One list of the Pro revenue texts for the Overview: per feature, either
 * the teaser (locked) or the results line (on Pro and switched on). Adding a
 * feature is one entry here.
 */
interface FeatureEntry {
  feature: RevenueFeature;
  title: string;
  /** sms_messages.kind its texts are logged under. */
  kind: string;
  enabled: (client: Client) => boolean;
  teaser: (client: Client) => Promise<Teaser>;
  /** Results line when its texts aren't one sms_messages kind. Default: revenueTextStats(kind). */
  results?: (client: Client) => Promise<string | null>;
}

const ENTRIES: FeatureEntry[] = [
  {
    feature: "quote_followup",
    title: "Quote follow-up",
    kind: "quote_followup",
    enabled: (c) => parseQuoteSettings(c.setupFlags).enabled,
    teaser: (c) => quoteTeaserFor(c),
    // Logged per step (quote_followup_1/_2) with its own 14-day attribution.
    results: async (c) => {
      const s = await getQuoteFollowupStats(c.id);
      if (!s) return null;
      return statsLine({ sent: s.textsSent, people: s.peopleTexted, failed: 0, replied: s.replies, bookedAfter: s.bookingsAfter });
    },
  },
  {
    feature: "winback",
    title: "Win-back texts",
    kind: "winback",
    enabled: (c) => winbackSettingsOf(c.setupFlags).enabled,
    teaser: (c) => winbackTeaserFor(c),
  },
];

export type RevenueOverview =
  | { mode: "locked"; items: { feature: RevenueFeature; title: string; teaser: Teaser }[] }
  | { mode: "results"; items: { feature: RevenueFeature; title: string; line: string }[] }
  | null;

export async function getRevenueOverview(client: Client): Promise<RevenueOverview> {
  const access = await planAccessFor(client).catch(() => null);
  if (!access) return null;
  const locked = ENTRIES.filter((e) => !access.has(e.feature));
  if (locked.length > 0) {
    const items = await Promise.all(
      locked.map(async (e) => ({ feature: e.feature, title: e.title, teaser: await e.teaser(client) })),
    );
    return { mode: "locked", items };
  }
  const on = ENTRIES.filter((e) => e.enabled(client));
  const lines = await Promise.all(
    on.map(async (e) => ({
      feature: e.feature,
      title: e.title,
      line: e.results ? await e.results(client) : statsLine(await revenueTextStats(client.id, e.kind)),
    })),
  );
  const items = lines.filter((l): l is { feature: RevenueFeature; title: string; line: string } => Boolean(l.line));
  return items.length ? { mode: "results", items } : null;
}
