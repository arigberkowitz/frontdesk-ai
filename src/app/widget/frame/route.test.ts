import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "fdw_abcdefghijklmnopqrstuvwxyz012345";
let row: Record<string, unknown> | undefined;
let planHas = true;

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/clients", () => ({ getWidgetFrameClient: async (k: string) => (k === KEY ? row : undefined) }));
vi.mock("@/lib/plan-access", () => ({ planAccessFor: async () => ({ has: (f: string) => f === "website_chat" && planHas }) }));

const { GET } = await import("./route");
const get = (q: string) => GET(new Request(`https://app.test/widget/frame?${q}`));

beforeEach(() => {
  planHas = true;
  row = {
    id: "c1",
    name: "Bayside Home Services",
    agentName: "Riley",
    status: "live",
    setupFlags: { chatWidget: { key: KEY, domains: ["bayside.example"] } },
  };
});

describe("GET /widget/frame", () => {
  it("renders the chat with the owner's domains as frame-ancestors", async () => {
    const res = await get(`key=${KEY}&lang=es&accent=%23112233`);
    const html = await res.text();
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self' https://bayside.example https://www.bayside.example",
    );
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(html).toContain('data-available="1"');
    expect(html).toContain('data-name="Bayside Home Services"');
    expect(html).toContain('data-accent="#112233"');
    expect(html).toContain('lang="es"');
  });

  it("is unavailable (and reveals nothing) for a non-Pro business", async () => {
    planHas = false;
    const html = await (await get(`key=${KEY}`)).text();
    expect(html).toContain('data-available="0"');
    expect(html).not.toContain("Bayside");
  });

  it("is unavailable for a paused business, an unknown key or a bad key", async () => {
    row = { ...row, status: "paused" };
    expect(await (await get(`key=${KEY}`)).text()).toContain('data-available="0"');
    expect(await (await get(`key=fdw_unknownunknownunknown0000`)).text()).toContain('data-available="0"');
    expect(await (await get(`key=<script>`)).text()).toContain('data-available="0"');
  });

  it("drops an accent that isn't a hex colour", async () => {
    const html = await (await get(`key=${KEY}&accent=red%22%3E%3Cscript%3E`)).text();
    expect(html).toContain('data-accent="#4f46e5"');
    expect(html).not.toContain("<script>");
  });
});
