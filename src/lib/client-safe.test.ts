import { describe, expect, it } from "vitest";
import type { Client } from "@/db/schema";
import { SERVER_ONLY_CLIENT_FIELDS, toSafeClient } from "./client-safe";

describe("toSafeClient", () => {
  const row = {
    id: "c1",
    name: "Bright Smile",
    calendarSecret: "enc:refresh-token",
    editCodeHash: "hmac-of-code",
    calendarAccount: "owner@biz.test",
  } as unknown as Client;

  it("drops the calendar credential and edit-code hash", () => {
    const safe = toSafeClient(row) as unknown as Record<string, unknown>;
    for (const f of SERVER_ONLY_CLIENT_FIELDS) expect(f in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain("refresh-token");
    expect(JSON.stringify(safe)).not.toContain("hmac-of-code");
  });

  it("keeps what the UI shows, and says whether an edit code is set", () => {
    const safe = toSafeClient(row);
    expect(safe.name).toBe("Bright Smile");
    expect(safe.calendarAccount).toBe("owner@biz.test");
    expect(safe.hasEditCode).toBe(true);
    expect(toSafeClient({ ...row, editCodeHash: null } as Client).hasEditCode).toBe(false);
  });
});
