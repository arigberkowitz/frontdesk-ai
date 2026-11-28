import { describe, expect, it } from "vitest";
import {
  frameAncestorSources,
  generateWidgetKey,
  isWidgetKey,
  normalizeDomain,
  originAllowed,
  parseDomainList,
  safeAccent,
  safeConversationId,
  widgetLang,
  widgetSettings,
} from "./widget-access";

const APP = "https://frontdeskai.company";

describe("widget keys", () => {
  it("are fdw_ + 32 url-safe chars, random each time", () => {
    const a = generateWidgetKey();
    const b = generateWidgetKey();
    expect(a).toMatch(/^fdw_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(isWidgetKey(a)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const k of ["", "fdw_", "fdw_short", "11111111-1111-4111-8111-111111111111", "fdw_abc'or'1'='1abcdefghijkl", null, 7]) {
      expect(isWidgetKey(k)).toBe(false);
    }
  });
});

describe("normalizeDomain", () => {
  it("takes what owners actually paste", () => {
    expect(normalizeDomain("Example.com")).toBe("example.com");
    expect(normalizeDomain("https://www.example.com/contact?x=1")).toBe("www.example.com");
    expect(normalizeDomain("example.com:443")).toBe("example.com");
    expect(normalizeDomain("*.example.co.uk")).toBe("*.example.co.uk");
    expect(normalizeDomain("my-site.squarespace.com")).toBe("my-site.squarespace.com");
  });

  it("refuses things that would match more than meant", () => {
    for (const bad of ["*", "*.com", "com", "localhost", "127.0.0.1", "10.0.0.1", "exa mple.com", "-bad.com", "a..com", "javascript:alert(1)"]) {
      expect(normalizeDomain(bad)).toBeNull();
    }
  });

  it("parses a textarea and reports what it couldn't read", () => {
    expect(parseDomainList("example.com\nhttps://book.example.com, example.com\n\nnot a site")).toEqual({
      domains: ["example.com", "book.example.com"],
      rejected: ["not a site"],
    });
  });
});

describe("originAllowed", () => {
  const list = ["acme.example", "*.shops.example"];
  it("allows the listed site, its www, and wildcard subdomains over https", () => {
    expect(originAllowed("https://acme.example", list, APP)).toBe(true);
    expect(originAllowed("https://www.acme.example", list, APP)).toBe(true);
    expect(originAllowed("https://a.shops.example", list, APP)).toBe(true);
  });
  it("refuses everything else", () => {
    expect(originAllowed("http://acme.example", list, APP)).toBe(false);
    expect(originAllowed("https://acme.example.evil.com", list, APP)).toBe(false);
    expect(originAllowed("https://evilacme.example", list, APP)).toBe(false);
    expect(originAllowed("https://shops.example", list, APP)).toBe(false);
    expect(originAllowed("https://blog.acme.example", list, APP)).toBe(false);
    expect(originAllowed("https://acme.example/path", list, APP)).toBe(false);
    expect(originAllowed("null", list, APP)).toBe(false);
    expect(originAllowed(null, list, APP)).toBe(false);
  });
  it("always allows our own origin (the portal preview)", () => {
    expect(originAllowed(APP, [], APP)).toBe(true);
  });
});

describe("frameAncestorSources", () => {
  it("is 'self' plus each https origin", () => {
    expect(frameAncestorSources(["acme.example", "*.shops.example"])).toEqual([
      "'self'",
      "https://acme.example",
      "https://www.acme.example",
      "https://*.shops.example",
    ]);
    expect(frameAncestorSources([])).toEqual(["'self'"]);
  });
  it("drops anything that isn't a clean hostname (no CSP injection)", () => {
    expect(frameAncestorSources(["evil.com; script-src *", "*"])).toEqual(["'self'"]);
  });
});

describe("widgetSettings", () => {
  it("reads key and domains, ignoring junk", () => {
    expect(widgetSettings(null)).toEqual({ key: null, domains: [] });
    expect(
      widgetSettings({ chatWidget: { key: "fdw_abcdefghijklmnopqrstuvwxyz012345", domains: ["acme.example", "bad domain", 3] } }),
    ).toEqual({ key: "fdw_abcdefghijklmnopqrstuvwxyz012345", domains: ["acme.example"] });
    expect(widgetSettings({ chatWidget: { key: "x" } }).key).toBeNull();
  });
});

describe("small inputs", () => {
  it("accent must be a 6-digit hex", () => {
    expect(safeAccent("#AABBCC")).toBe("#aabbcc");
    expect(safeAccent("red;}body{display:none")).toBe("#4f46e5");
  });
  it("language is en or es", () => {
    expect(widgetLang("es-MX")).toBe("es");
    expect(widgetLang("fr")).toBe("en");
    expect(widgetLang(undefined)).toBe("en");
  });
  it("conversation ids are short and plain", () => {
    expect(safeConversationId("a1b2c3d4e5f6")).toBe("a1b2c3d4e5f6");
    expect(safeConversationId("<script>")).toBeNull();
  });
});
