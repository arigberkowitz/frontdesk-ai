import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../../next.config";
import { metadata as notFoundMeta } from "@/app/not-found";
import { metadata as signInMeta } from "@/app/sign-in/[[...sign-in]]/page";

describe("site hardening", () => {
  it("sends baseline security headers on every path", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path((?!widget/frame$).*)");
    expect(all?.headers).toEqual(SECURITY_HEADERS);
    // The website chat iframe is the one framable route: same headers minus
    // X-Frame-Options (its own CSP frame-ancestors lists the owner's domains).
    const frame = rules.find((r) => r.source === "/widget/frame");
    expect(frame?.headers.map((h) => h.key)).not.toContain("X-Frame-Options");
    expect(frame?.headers.map((h) => h.key)).toContain("X-Content-Type-Options");
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]));
    // The browser test call needs the mic.
    expect(SECURITY_HEADERS.find((h) => h.key === "Permissions-Policy")?.value).toContain("microphone=(self)");
  });

  it("404 has its own title and is not indexable", () => {
    expect(notFoundMeta.title).toBe("Page not found");
    expect(notFoundMeta.robots).toMatchObject({ index: false });
  });

  it("sign-in is kept out of search results", () => {
    expect(signInMeta.robots).toMatchObject({ index: false });
  });

  it("redirects /signup to /sign-up permanently and keeps the query string", async () => {
    const rules = await nextConfig.redirects!();
    const typo = rules.find((r) => r.source === "/signup");
    expect(typo).toMatchObject({ destination: "/sign-up", permanent: true });
    // Next.js appends the original query string to destination unless it already
    // has one. /sign-up is bare, so ?plan=&interval= survive the hop.
    expect(typo?.destination).not.toContain("?");
  });
});
