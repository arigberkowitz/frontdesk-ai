/**
 * The HTML for the website chat iframe (/widget/frame) and its own CSP.
 *
 * Pure (no I/O) so the markup and policy are pinned by tests. The frame is a
 * tiny static document: one stylesheet and one script, both from our origin
 * (public/widget/frame.css, public/widget/frame.js), no inline script or
 * style, no cookies, no storage. Everything the script needs is in data-*
 * attributes on <html>, HTML-escaped.
 */
import { CSP_REPORT_PATH } from "@/lib/csp";
import { frameAncestorSources, type WidgetLang } from "./widget-access";

export interface FrameView {
  available: boolean;
  key?: string;
  businessName?: string;
  agentName?: string;
  lang: WidgetLang;
  accent: string;
  /** Portal preview: open on load, fill the frame, no launcher. */
  preview?: boolean;
  /** Bumps the asset URLs so a deploy isn't stuck behind a cached script. */
  assetVersion?: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The frame's Content-Security-Policy. Enforced, not report-only: this page is
 * ours end to end and has nothing third-party in it. `frame-ancestors` is the
 * domain allow-list: browsers refuse to render the chat on any other site.
 * An unavailable frame renders nothing but a "not available" signal, so it
 * may be framed anywhere (the embed script needs to hear it to clean up).
 */
export function frameCsp(domains: string[] | null): string {
  const ancestors = domains === null ? ["*"] : frameAncestorSources(domains);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestors.join(" ")}`,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

export function frameHtml(v: FrameView): string {
  const ver = v.assetVersion ? `?v=${encodeURIComponent(v.assetVersion)}` : "";
  const attrs: Array<[string, string]> = [
    ["lang", v.lang],
    ["data-available", v.available ? "1" : "0"],
    ["data-lang", v.lang],
    ["data-accent", v.accent],
  ];
  if (v.available) {
    attrs.push(["data-key", v.key ?? ""], ["data-name", v.businessName ?? ""], ["data-agent", v.agentName ?? ""]);
  }
  if (v.preview) attrs.push(["data-preview", "1"]);
  const title = v.available && v.businessName ? `Chat with ${v.businessName}` : "Chat";
  return [
    "<!doctype html>",
    `<html ${attrs.map(([k, val]) => `${k}="${escapeHtml(val)}"`).join(" ")}>`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="stylesheet" href="/widget/frame.css${ver}">`,
    "</head>",
    `<body><div id="app"></div><script src="/widget/frame.js${ver}" defer></script></body>`,
    "</html>",
  ].join("\n");
}
