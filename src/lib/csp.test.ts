import { describe, expect, it } from "vitest";
import {
  CSP_ENFORCE,
  CSP_HEADER_ENFORCE,
  CSP_HEADER_REPORT_ONLY,
  buildCsp,
  clerkFrontendHost,
  cspHeadersFor,
  generateNonce,
  sentryIngestOrigin,
} from "./csp";

// pk_live_ + base64("clerk.frontdeskai.company$")
const LIVE_PK = "pk_live_Y2xlcmsuZnJvbnRkZXNrYWkuY29tcGFueSQ";

function directive(csp: string, name: string): string[] {
  const d = csp.split("; ").find((p) => p.startsWith(`${name} `));
  return d ? d.split(" ").slice(1) : [];
}

describe("generateNonce", () => {
  it("is 128 bits of base64, different every time, and safe in an HTML attribute", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toMatch(/[<>&"']/);
  });
});

describe("clerkFrontendHost", () => {
  it("reads the frontend API host out of a publishable key", () => {
    expect(clerkFrontendHost(LIVE_PK)).toBe("clerk.frontdeskai.company");
  });
  it("returns null for missing or malformed keys", () => {
    expect(clerkFrontendHost(undefined)).toBeNull();
    expect(clerkFrontendHost("")).toBeNull();
    expect(clerkFrontendHost("pk_live_")).toBeNull();
    expect(clerkFrontendHost("pk_live_!!!notbase64")).toBeNull();
    // Decodes to "evil.com/path$": not a bare hostname, so it must not reach a header.
    expect(clerkFrontendHost(`pk_live_${btoa("evil.com/path$")}`)).toBeNull();
    expect(clerkFrontendHost(`pk_live_${btoa("a b.com;$")}`)).toBeNull();
  });
});

describe("sentryIngestOrigin", () => {
  it("returns the https origin of the DSN host, without the key or project path", () => {
    expect(sentryIngestOrigin("https://abc123@o42.ingest.us.sentry.io/99")).toBe("https://o42.ingest.us.sentry.io");
  });
  it("ignores missing, non-https and malformed DSNs", () => {
    expect(sentryIngestOrigin(undefined)).toBeNull();
    expect(sentryIngestOrigin("http://k@o1.ingest.sentry.io/1")).toBeNull();
    expect(sentryIngestOrigin("not a url")).toBeNull();
  });
});

describe("buildCsp (production)", () => {
  const csp = buildCsp({ nonce: "NONCE123", clerkPublishableKey: LIVE_PK });

  it("uses a nonce and strict-dynamic for scripts, with no unsafe-inline or unsafe-eval", () => {
    expect(directive(csp, "script-src")).toEqual(["'self'", "'nonce-NONCE123'", "'strict-dynamic'"]);
  });

  it("locks down the high-value directives", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
  });

  it("allows form posts to us and to Stripe's hosted pages only", () => {
    expect(directive(csp, "form-action")).toEqual(["'self'", "https://checkout.stripe.com", "https://billing.stripe.com"]);
  });

  it("allows exactly the third-party origins the browser talks to", () => {
    expect(directive(csp, "connect-src")).toEqual([
      "'self'",
      "https://clerk.frontdeskai.company",
      "https://clerk-telemetry.com",
      "https://*.clerk-telemetry.com",
      "https://*.client.protect.clerk.com:*",
      "https://api.retellai.com",
      "https://*.livekit.cloud",
      "wss://*.livekit.cloud",
    ]);
    expect(directive(csp, "img-src")).toContain("https://img.clerk.com");
    expect(directive(csp, "frame-src")).toEqual(["https://challenges.cloudflare.com"]);
  });

  it("never allows a wildcard or bare scheme for scripts, frames or forms", () => {
    for (const name of ["script-src", "frame-src", "form-action", "object-src"]) {
      for (const v of directive(csp, name)) {
        expect(v).not.toBe("*");
        expect(v).not.toBe("https:");
        expect(v).not.toBe("http:");
      }
    }
  });

  it("points reports at the same-origin endpoint", () => {
    expect(csp).toMatch(/; report-uri \/api\/csp-report$/);
  });

  it("leaves out upgrade-insecure-requests when report-only (browsers warn about it)", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("adds upgrade-insecure-requests when enforcing", () => {
    expect(buildCsp({ nonce: "N", enforce: true })).toContain("; upgrade-insecure-requests;");
  });

  it("has no dev-only allowances", () => {
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws://");
    expect(csp).not.toContain("accounts.dev");
  });

  it("falls back to the production Clerk host when the key can't be read", () => {
    expect(directive(buildCsp({ nonce: "N" }), "connect-src")).toContain("https://clerk.frontdeskai.company");
  });

  it("adds Sentry's ingest origin only when a DSN is configured", () => {
    expect(directive(csp, "connect-src").join(" ")).not.toContain("sentry");
    const withSentry = buildCsp({ nonce: "N", sentryDsn: "https://k@o42.ingest.us.sentry.io/9" });
    expect(directive(withSentry, "connect-src")).toContain("https://o42.ingest.us.sentry.io");
  });

  it("never lets a hostile nonce or key inject a directive", () => {
    const out = buildCsp({ nonce: "N", clerkPublishableKey: `pk_live_${btoa("x.com; script-src *$")}` });
    expect(out.split("; ").filter((p) => p.startsWith("script-src "))).toHaveLength(1);
  });
});

describe("buildCsp (dev)", () => {
  it("allows eval, the HMR socket and Clerk's dev instances", () => {
    const csp = buildCsp({ nonce: "N", isDev: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toEqual(expect.arrayContaining(["ws://localhost:*", "https://*.clerk.accounts.dev"]));
  });
});

describe("cspHeadersFor", () => {
  it("ships report-only while CSP_ENFORCE is false", () => {
    // The shipped state of the switch. Flipping CSP_ENFORCE to true is the one
    // intended change; update this expectation in the same commit.
    expect(CSP_ENFORCE).toBe(false);
    const h = cspHeadersFor({ nodeEnv: "production", clerkPublishableKey: LIVE_PK });
    expect(h.name).toBe(CSP_HEADER_REPORT_ONLY);
    expect(h.value).toContain(`'nonce-${h.nonce}'`);
  });

  it("switches header name and adds upgrade-insecure-requests when enforcing", () => {
    const h = cspHeadersFor({ nodeEnv: "production", enforce: true });
    expect(h.name).toBe(CSP_HEADER_ENFORCE);
    expect(h.value).toContain("upgrade-insecure-requests");
  });

  it("mints a new nonce per call", () => {
    expect(cspHeadersFor({}).nonce).not.toBe(cspHeadersFor({}).nonce);
  });

  it("treats only NODE_ENV=development as dev", () => {
    expect(cspHeadersFor({ nodeEnv: "development" }).value).toContain("unsafe-eval");
    expect(cspHeadersFor({ nodeEnv: "production" }).value).not.toContain("unsafe-eval");
    expect(cspHeadersFor({ nodeEnv: "test" }).value).not.toContain("unsafe-eval");
  });
});
