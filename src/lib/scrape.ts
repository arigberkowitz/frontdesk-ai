import "server-only";
import * as cheerio from "cheerio";
import { logger } from "./logger";

/**
 * Lightweight website scraper for onboarding (§8). Fetches the homepage plus a
 * few obvious pages (services, about, contact, hours, pricing, FAQ), strips
 * boilerplate, and returns readable text for Claude to structure. Defensive:
 * per-page timeouts, same-origin only, capped page count + total length.
 */
const FETCH_TIMEOUT_MS = 10_000;
const MAX_EXTRA_PAGES = 5;
const MAX_TOTAL_CHARS = 40_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; FrontDeskAI-Onboarding/1.0; +https://frontdesk.ai/bot)";

const LINK_KEYWORDS = [
  "service",
  "about",
  "contact",
  "hour",
  "pricing",
  "price",
  "faq",
  "book",
  "appointment",
  "menu",
];

export interface ScrapedPage {
  url: string;
  title: string;
  text: string;
}

export interface ScrapeResult {
  homepageTitle: string;
  pages: ScrapedPage[];
  combinedText: string;
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    return await res.text();
  } catch (err) {
    logger.warn("scrape.fetch_failed", { url, error: err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip scripts/nav/footer and collapse whitespace into readable text. */
function extractReadable($: cheerio.CheerioAPI): { title: string; text: string } {
  $("script, style, noscript, svg, nav, footer, header, form, iframe").remove();
  const title = $("title").first().text().trim() || $("h1").first().text().trim();
  const body = $("main").length ? $("main") : $("body");
  const text = body
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return { title, text };
}

function sameOriginLinks($: cheerio.CheerioAPI, baseUrl: URL): string[] {
  const found = new Map<string, number>(); // url -> score
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (resolved.origin !== baseUrl.origin) return;
    resolved.hash = "";
    const key = resolved.toString();
    if (key === baseUrl.toString()) return;
    const hay = `${resolved.pathname} ${$(el).text()}`.toLowerCase();
    const score = LINK_KEYWORDS.reduce((s, kw) => (hay.includes(kw) ? s + 1 : s), 0);
    if (score > 0) found.set(key, Math.max(found.get(key) ?? 0, score));
  });
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url);
}

export async function scrapeWebsite(rawUrl: string): Promise<ScrapeResult> {
  const url = normalizeUrl(rawUrl);
  const base = new URL(url);

  const homeHtml = await fetchHtml(url);
  if (!homeHtml) {
    return { homepageTitle: "", pages: [], combinedText: "" };
  }

  const $home = cheerio.load(homeHtml);
  // Discover links BEFORE extractReadable() strips nav/header/footer — that's
  // exactly where a site's navigation links live.
  const candidates = sameOriginLinks($home, base).slice(0, MAX_EXTRA_PAGES);
  const home = extractReadable($home);
  const pages: ScrapedPage[] = [{ url, title: home.title, text: home.text }];
  const extra = await Promise.all(
    candidates.map(async (link) => {
      const html = await fetchHtml(link);
      if (!html) return null;
      const { title, text } = extractReadable(cheerio.load(html));
      return { url: link, title, text };
    }),
  );
  for (const p of extra) {
    if (p && p.text) pages.push(p);
  }

  let combinedText = pages
    .map((p) => `# ${p.title || p.url}\n${p.text}`)
    .join("\n\n---\n\n");
  if (combinedText.length > MAX_TOTAL_CHARS) {
    combinedText = `${combinedText.slice(0, MAX_TOTAL_CHARS)}\n…[truncated]`;
  }

  return { homepageTitle: home.title, pages, combinedText };
}
