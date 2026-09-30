import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Access control for the Messages pages: the business is ALWAYS the one on
 * the signed-in session (resolvePortalClient). Nothing in the URL can choose
 * another business, a thread with no rows for this business is a 404, and an
 * operator previewing the portal doesn't clear the owner's unread markers.
 */

const SESSION_CLIENT = "client-mine";
let preview = false;

const getThread = vi.fn();
const markThreadRead = vi.fn();
const listConversations = vi.fn();

vi.mock("@/lib/auth-guard", () => ({
  resolvePortalClient: async () => ({ clientId: SESSION_CLIENT, preview }),
}));
vi.mock("@/lib/data/clients", () => ({
  getClientByIdUnsafe: async (id: string) => ({ id, timezone: "America/New_York" }),
}));
vi.mock("@/lib/data/callers", () => ({
  getCallerContext: async () => ({ name: null, priorCalls: 0 }),
  listCallerNames: async () => [],
}));
vi.mock("@/lib/data/sms-messages", () => ({ getThread, markThreadRead, listConversations }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const ThreadPage = (await import("./[phone]/page")).default;
const ListPage = (await import("./page")).default;

const msg = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  clientId: SESSION_CLIENT,
  direction: "inbound",
  customerPhone: "14155550100",
  body: "hi",
  status: "received",
  kind: "reply",
  appointmentId: null,
  leadId: null,
  error: null,
  createdAt: new Date("2026-09-01T10:00:00Z"),
  ...over,
});

beforeEach(() => {
  preview = false;
  getThread.mockReset();
  markThreadRead.mockReset();
  listConversations.mockReset();
  listConversations.mockResolvedValue([]);
});

describe("Messages pages — tenant isolation", () => {
  it("the list is loaded for the session's business only", async () => {
    await ListPage();
    expect(listConversations).toHaveBeenCalledWith(SESSION_CLIENT);
  });

  it("a thread is looked up and marked read under the session's business", async () => {
    getThread.mockResolvedValue([msg()]);
    await ThreadPage({ params: Promise.resolve({ phone: "14155550100" }) });
    expect(getThread).toHaveBeenCalledWith(SESSION_CLIENT, "14155550100");
    expect(markThreadRead).toHaveBeenCalledWith(SESSION_CLIENT, "14155550100");
  });

  it("404s a customer this business has no messages with (e.g. another business's customer)", async () => {
    getThread.mockResolvedValue([]);
    await expect(ThreadPage({ params: Promise.resolve({ phone: "14155550222" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(markThreadRead).not.toHaveBeenCalled();
  });

  it("404s a malformed phone segment without querying", async () => {
    await expect(ThreadPage({ params: Promise.resolve({ phone: "abc'--" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getThread).not.toHaveBeenCalled();
  });

  it("an operator preview can read the thread but doesn't mark it read for the owner", async () => {
    preview = true;
    getThread.mockResolvedValue([msg()]);
    await ThreadPage({ params: Promise.resolve({ phone: "14155550100" }) });
    expect(markThreadRead).not.toHaveBeenCalled();
  });
});
