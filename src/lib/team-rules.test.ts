import { describe, expect, it } from "vitest";
import {
  dbRoleToTeam,
  ownerOnlyFieldsIn,
  parseTeamRole,
  teamRoleToDb,
  wouldOrphanBusiness,
} from "./team-rules";

describe("team rules", () => {
  it("maps roles both ways", () => {
    expect(teamRoleToDb("owner")).toBe("client_admin");
    expect(teamRoleToDb("staff")).toBe("client_viewer");
    expect(dbRoleToTeam("client_viewer")).toBe("staff");
    expect(dbRoleToTeam("client_admin")).toBe("owner");
    expect(parseTeamRole("admin")).toBeNull();
    expect(parseTeamRole("owner")).toBe("owner");
  });

  it("flags owner-only profile fields", () => {
    const f = new FormData();
    f.set("name", "x");
    expect(ownerOnlyFieldsIn(f)).toEqual([]);
    f.set("alertPhone", "");
    expect(ownerOnlyFieldsIn(f)).toEqual(["alertPhone"]);
    f.set("weeklySummaryEnabled", "off");
    expect(ownerOnlyFieldsIn(f)).toEqual(["alertPhone", "weeklySummaryEnabled"]);
  });

  it("never lets a business drop to zero owners", () => {
    const base = { change: "remove" as const, actorRole: "client_admin" as const };
    expect(wouldOrphanBusiness({ ...base, targetRole: "client_admin", ownerCount: 1 })).toBe(true);
    expect(wouldOrphanBusiness({ ...base, targetRole: "client_admin", ownerCount: 2 })).toBe(false);
    expect(wouldOrphanBusiness({ ...base, targetRole: "client_viewer", ownerCount: 1 })).toBe(
      false,
    );
    expect(
      wouldOrphanBusiness({
        ...base,
        actorRole: "operator",
        targetRole: "client_admin",
        ownerCount: 1,
      }),
    ).toBe(false);
  });
});
