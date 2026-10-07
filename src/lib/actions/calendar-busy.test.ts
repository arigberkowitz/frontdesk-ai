import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings → Calendar → "Calendars that count as busy". Google ids are typed
 * and checked with freeBusy (no calendar-list scope); Outlook ids must come
 * from the mailbox's own list. Provider calls are mocks.
 */

const USER = { id: "u1", orgId: "org1" };
let client: Record<string, unknown> = {};
let editorOk = true;
const updateClient = vi.fn(async (..._a: unknown[]) => {});
const freeBusyRaw = vi.fn(async (_t: string, ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { busy: [], error: id.startsWith("bad") ? "notFound" : null }])),
);
const msListCalendars = vi.fn(async (_t: string) => [
  { id: "AAA", name: "Calendar", isDefault: true, owner: null },
  { id: "BBB", name: "Family", isDefault: false, owner: null },
  { id: "CCC", name: "Team", isDefault: false, owner: null },
]);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireClientEditor: async () => (editorOk ? { ok: true, user: USER } : { ok: false, error: "locked" }),
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: async () => client,
  updateClient: (...a: unknown[]) => updateClient(...a),
}));
vi.mock("@/lib/agent-publish", () => ({ applyClientEdit: vi.fn() }));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) => {
    if (!s.startsWith("enc(")) throw new Error("bad");
    return s.slice(4, -1);
  },
}));
vi.mock("@/lib/google-calendar", () => ({
  revokeGoogleToken: vi.fn(),
  getAccessToken: async () => "g-at",
  freeBusyRaw: (t: string, ids: string[]) => freeBusyRaw(t, ids),
}));
vi.mock("@/lib/microsoft-calendar", () => ({
  getMsTokens: async () => ({ accessToken: "ms-at", rotatedRefreshToken: null }),
  msListCalendars: (t: string) => msListCalendars(t),
}));
vi.mock("@/db", () => ({ db: { update: () => ({ set: () => ({ where: async () => undefined }) }) } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { saveBusyCalendarsAction } = await import("./calendar");
const { normalizeBusyIds } = await import("@/lib/busy-calendars");

function form(ids: string[], add = ""): FormData {
  const f = new FormData();
  f.set("clientId", "c1");
  for (const id of ids) f.append("calendarId", id);
  if (add) f.set("addCalendarId", add);
  return f;
}
const save = (f: FormData) => saveBusyCalendarsAction({ ok: false } as never, f);

beforeEach(() => {
  editorOk = true;
  for (const f of [updateClient, freeBusyRaw, msListCalendars]) f.mockClear();
});

describe("saveBusyCalendarsAction — Google (typed ids, freeBusy check)", () => {
  beforeEach(() => {
    client = { id: "c1", calendarProvider: "google", calendarSecret: "enc(r)", calendarId: "primary", calendarAccount: "owner@gmail.test" };
  });

  it("checks typed ids with freeBusy and saves them", async () => {
    const r = await save(form(["family@group.calendar.google.com"], "work@biz.test"));
    expect(freeBusyRaw).toHaveBeenCalledWith("g-at", ["family@group.calendar.google.com", "work@biz.test"]);
    expect(updateClient).toHaveBeenCalledWith("org1", "c1", {
      calendarBusyIds: ["family@group.calendar.google.com", "work@biz.test"],
    });
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/2 more calendars/) });
  });

  it("refuses an id Google can't see and saves nothing", async () => {
    const r = await save(form([], "bad@group.calendar.google.com"));
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.addCalendarId?.[0]).toMatch(/share that calendar with owner@gmail.test/);
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("removing everything clears the picks (back to the main calendar only)", async () => {
    const r = await save(form([]));
    expect(freeBusyRaw).not.toHaveBeenCalled();
    expect(updateClient).toHaveBeenCalledWith("org1", "c1", { calendarBusyIds: null });
    expect(r.message).toMatch(/Only your main calendar/);
  });

  it("caps the number of extra calendars", async () => {
    const r = await save(form(Array.from({ length: 11 }, (_, i) => `c${i}@x.test`)));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/up to 10/) });
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("locked staff can't change it", async () => {
    editorOk = false;
    const r = await save(form([], "x@y.test"));
    expect(r).toEqual({ ok: false, error: "locked" });
    expect(updateClient).not.toHaveBeenCalled();
  });
});

describe("saveBusyCalendarsAction — Outlook (picked from the mailbox list)", () => {
  beforeEach(() => {
    client = { id: "c1", calendarProvider: "microsoft", calendarSecret: "enc(r)", calendarId: "primary" };
  });

  it("keeps only real, non-default calendars from the mailbox", async () => {
    await save(form(["BBB", "AAA", "NOT-MINE"]));
    expect(msListCalendars).toHaveBeenCalledWith("ms-at");
    expect(updateClient).toHaveBeenCalledWith("org1", "c1", { calendarBusyIds: ["BBB"] });
  });
});

describe("saveBusyCalendarsAction — no Google/Outlook calendar", () => {
  it("Cal.com: nothing to pick", async () => {
    client = { id: "c1", calendarProvider: "calcom", calendarSecret: "enc(k)", calendarId: "1" };
    const r = await save(form(["x"]));
    expect(r.ok).toBe(false);
    expect(updateClient).not.toHaveBeenCalled();
  });
});

describe("normalizeBusyIds", () => {
  it("trims, de-dupes, drops blanks and the booking calendar", () => {
    expect(normalizeBusyIds([" a@x ", "a@x", "", "primary", "main@x", "b@x"], "main@x")).toEqual(["a@x", "b@x"]);
  });
});
