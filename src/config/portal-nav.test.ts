import { describe, expect, it } from "vitest";
import {
  PORTAL_NAV_GROUPS,
  isPortalNavActive,
  portalNavFor,
  portalNavItems,
} from "./portal-nav";
import {
  SETTINGS_SECTIONS,
  legacySettingsHashTarget,
  settingsSectionsFor,
} from "./portal-settings-sections";

describe("portal nav", () => {
  it("groups the portal into Inbox, Schedule and Receptionist, with Overview first and Settings last", () => {
    expect(PORTAL_NAV_GROUPS.map((g) => g.label)).toEqual([null, "Inbox", "Schedule", "Receptionist", null]);
    const items = portalNavItems();
    expect(items[0].href).toBe("/portal");
    expect(items.at(-1)?.href).toBe("/portal/settings");
  });

  it("has unique hrefs", () => {
    const hrefs = portalNavItems().map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("never labels anything plain 'Team' — the staff board is 'Staff', sign-ins are 'Team access'", () => {
    expect(portalNavItems().some((i) => i.label === "Team")).toBe(false);
    expect(portalNavItems().find((i) => i.key === "staff")?.href).toBe("/portal/staff");
  });

  it("hides Staff for a solo business", () => {
    expect(portalNavItems(false).some((i) => i.key === "staff")).toBe(false);
    expect(portalNavFor(false).every((g) => g.items.length > 0)).toBe(true);
  });

  it("highlights parents for nested pages but never Overview for everything", () => {
    expect(isPortalNavActive("/portal", "/portal")).toBe(true);
    expect(isPortalNavActive("/portal/calls", "/portal")).toBe(false);
    expect(isPortalNavActive("/portal/calls/abc", "/portal/calls")).toBe(true);
    expect(isPortalNavActive("/portal/settings/team", "/portal/settings")).toBe(true);
    expect(isPortalNavActive("/portal/servicesX", "/portal/services")).toBe(false);
  });
});

describe("settings sections", () => {
  it("opens on Business at /portal/settings and keeps Team access at its old URL", () => {
    expect(SETTINGS_SECTIONS[0]).toMatchObject({ key: "business", href: "/portal/settings" });
    expect(SETTINGS_SECTIONS.find((s) => s.key === "team")?.href).toBe("/portal/settings/team");
  });

  it("hides owner-only sections from staff", () => {
    expect(settingsSectionsFor(false).some((s) => s.key === "team")).toBe(false);
    expect(settingsSectionsFor(true).some((s) => s.key === "team")).toBe(true);
  });

  it("maps old #anchors on the long Settings page to the section that now holds them", () => {
    expect(legacySettingsHashTarget("#forwarding")).toBe("/portal/settings/phone#forwarding");
    expect(legacySettingsHashTarget("#weekly-summary")).toBe("/portal/settings/alerts#weekly-summary");
    expect(legacySettingsHashTarget("#calendar")).toBe("/portal/settings/calendar");
    expect(legacySettingsHashTarget("#help")).toBe("/portal/settings/help");
    expect(legacySettingsHashTarget("#advanced")).toBe("/portal/settings/follow-ups#advanced");
    expect(legacySettingsHashTarget("")).toBeNull();
    expect(legacySettingsHashTarget("#nope")).toBeNull();
  });
});
