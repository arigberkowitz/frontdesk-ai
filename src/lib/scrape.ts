import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
  "Mozilla/5.0 (compatible; FrontDeskAI-Onboarding/1.0; +https://frontdeskai.company)";

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

/* ----------------------------- SSRF protection ---------------------------
 * These URLs come from users (onboarding "paste your website", growth
 * prospecting), so every fetch — including each redirect hop — must resolve to
 * a public address. Otherwise a pasted URL like http://169.254.169.254/ or a
 * site that 302s to localhost reads internal services back to the user.
 * ------------------------------------------------------------------------ */

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast / reserved
    );
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    return (
      low === "::" ||
      low === "::1" ||
      low.startsWith("fe80") || // link-local
      low.startsWith("fc") || // unique-local
      low.startsWith("fd") ||
      low.startsWith("::ffff:") // v4-mapped — re-check the embedded v4
    );
  }
  return false;
}

/** True when the URL is http(s) on a default port and resolves to a public IP. */
async function isSafePublicUrl(url: URL): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return false;
  }
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

const MAX_REDIRECTS = 3;

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Follow redirects manually so every hop gets the public-address check.
    let current = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isSafePublicUrl(current))) {
        logger.warn("scrape.blocked_url", { url: current.toString() });
        return null;
      }
      const res = await fetch(current, {
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) return null;
        current = new URL(location, current);
        continue;
      }
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("html")) return null;
      return await res.text();
    }
    return null;
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
