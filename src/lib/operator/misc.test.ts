import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeSuspension, isSuspended } from "./suspension";
import { identityFrom, matchesBlock, normalizeEmail, normalizePhone } from "./trial-block";
import { isGone } from "./providers";

const free = (d: string) => ["gmail.com", "yahoo.com"].includes(d);
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("isSuspended", () => {
  it("reads a client row, bare flags, or nothing", () => {
    const sus = { at: "x", by: "u", mode: "off" as const, previousStatus: "live" as const, stripe: { action: "none" as const, prorate: false } };
    expect(isSuspended({ setupFlags: { suspended: sus } })).toBe(true);
    expect(isSuspended({ suspended: sus })).toBe(true);
    expect(isSuspended({ setupFlags: {} })).toBe(false);
    expect(isSuspended({ setupFlags: null })).toBe(false);
    expect(isSuspended(null)).toBe(false);
    expect(describeSuspension(sus)).toMatch(/detached/);
  });
});

describe("fraud flag identities", () => {
  it("normalises emails and phones", () => {
    expect(normalizeEmail(" Pat@Acme.COM ")).toBe("pat@acme.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizePhone("+1 (415) 555-0100")).toBe("4155550100");
    expect(normalizePhone("555-0100")).toBeNull();
  });
  it("never blocks a whole free-mail domain, but does block a company domain", () => {
    expect(identityFrom({ emails: ["a@gmail.com"], phones: [] }, free).domain).toBeNull();
    expect(identityFrom({ emails: ["a@acme.com"], phones: [] }, free).domain).toBe("acme.com");
  });
  it("blocks the same email, phone, or company domain from a new signup — and only those", () => {
    const blocks = [identityFrom({ emails: ["boss@acme.com"], phones: ["415-555-0100"] }, free)];
    expect(matchesBlock(blocks, { emails: ["BOSS@acme.com"], phones: [] }, free)).toBe(true);
    expect(matchesBlock(blocks, { emails: ["new@acme.com"], phones: [] }, free)).toBe(true); // same company domain
    expect(matchesBlock(blocks, { emails: ["x@other.com"], phones: ["+14155550100"] }, free)).toBe(true); // same phone
    expect(matchesBlock(blocks, { emails: ["x@other.com"], phones: ["212-555-0000"] }, free)).toBe(false);
    const gmail = [identityFrom({ emails: ["scam@gmail.com"], phones: [] }, free)];
    expect(matchesBlock(gmail, { emails: ["honest@gmail.com"], phones: [] }, free)).toBe(false);
    expect(matchesBlock(gmail, { emails: ["scam@gmail.com"], phones: [] }, free)).toBe(true);
  });
});

describe("vendor 'already gone' detection", () => {
  it("recognises Retell 404/422, Twilio 20404 and Stripe resource_missing, and nothing else", () => {
    expect(isGone({ status: 404 })).toBe(true);
    expect(isGone({ code: "resource_missing" })).toBe(true);
    expect(isGone({ code: 20404 })).toBe(true);
    expect(isGone(new Error("Cannot find requested asset under given api key."))).toBe(true);
    expect(isGone(new Error("No such subscription: 'sub_1'"))).toBe(true);
    expect(isGone({ status: 500, message: "internal error" })).toBe(false);
    expect(isGone(new Error("card declined"))).toBe(false);
  });
});

describe("wiring (so a refactor can't silently open or drop a guard)", () => {
  it("both operator routes go through the shared authorizer, and only POST/GET handlers exist", () => {
    const c = src("src/app/api/operator/clients/[id]/route.ts");
    const o = src("src/app/api/operator/orphans/route.ts");
    expect(c).toMatch(/authorize: liveAuthorize/);
    expect(o).toMatch(/authorize: liveAuthorize/g);
    expect(c).not.toMatch(/export async function (GET|DELETE|PUT|PATCH)/);
  });
  it("owner server actions are blocked for a suspended company", () => {
    const g = src("src/lib/auth-guard.ts");
    expect(g).toMatch(/isClientSuspended\(clientId, \{ strict: true \}\)/g);
  });
  it("the portal renders the suspended page, the Stripe webhook and number-buyers skip suspended companies", () => {
    expect(src("src/app/portal/layout.tsx")).toMatch(/SuspendedPage/);
    expect(src("src/app/api/webhooks/stripe/route.ts")).toMatch(/isSuspended\(client\)/);
    expect(src("src/lib/provision.ts")).toMatch(/operatorNumberHoldAt/);
    expect(src("src/lib/data/tollfree.ts")).toMatch(/operatorNumberHoldAt/);
    expect(src("src/lib/data/inbound-screen.ts")).toMatch(/suspended\?\.mode === "off"/);
    expect(src("src/lib/notifier.ts")).toMatch(/isClientSuspended\(onBehalfOf\)/);
  });
  it("the operator page and the client controls are only mounted on operator screens", () => {
    expect(src("src/app/(dashboard)/platform/page.tsx")).toMatch(/OrphansCard/);
    expect(src("src/components/clients/client-detail.tsx")).toMatch(/operator \? <OperatorControls/);
    // never imported from the owner portal
    expect(src("src/app/portal/layout.tsx")).not.toMatch(/operator-controls|OperatorControls/);
  });
});
