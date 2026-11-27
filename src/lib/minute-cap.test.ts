import { describe, expect, it } from "vitest";
import { MINUTE_CAP_GRACE_PCT, PLANS, minuteAlertThreshold, minutesLabel } from "@/config/plans";
import {
  adminCapLine,
  countedSeconds,
  minuteCapDecision,
  nextMinuteCapFlags,
  planThatFits,
  renderOwnerCapEmail,
  usedMinutesFromSeconds,
} from "./minute-cap";

const may = new Date("2026-05-03T00:00:00.000Z");
const june = new Date("2026-06-03T00:00:00.000Z");

describe("caps and the 10% grace", () => {
  it("one constant sets the grace", () => {
    expect(MINUTE_CAP_GRACE_PCT).toBe(10);
  });
  it("Rescue 200 → 220, Starter 500 → 550, Pro 2,500 (fair use) → 2,750", () => {
    expect(PLANS.backup.includedMinutes).toBe(200);
    expect(PLANS.starter.includedMinutes).toBe(500);
    expect(PLANS.pro.includedMinutes).toBe(2_500);
    expect(PLANS.pro.fairUse).toBe(true);
    expect(minuteAlertThreshold(PLANS.backup)).toBe(220);
    expect(minuteAlertThreshold(PLANS.starter)).toBe(550);
    expect(minuteAlertThreshold(PLANS.pro)).toBe(2_750);
    expect(minuteAlertThreshold({ includedMinutes: null })).toBeNull();
  });
});

describe("minuteCapDecision", () => {
  const at = (plan: "backup" | "starter" | "pro", usedMinutes: number, flags?: Parameters<typeof minuteCapDecision>[0]["flags"]) =>
    minuteCapDecision({ plan, usedMinutes, periodStart: may, flags });

  it("nothing at the cap, nothing inside the grace, nothing exactly at cap + 10%", () => {
    for (const used of [0, 200, 201, 219, 220]) {
      expect(at("backup", used)).toMatchObject({ over: false, sendOwner: false, flagAdmin: false });
    }
    expect(at("starter", 550).over).toBe(false);
    expect(at("pro", 2_750).over).toBe(false);
  });

  it("one minute past cap + 10% warns the owner and flags the operator", () => {
    expect(at("backup", 221)).toEqual({ over: true, threshold: 220, sendOwner: true, flagAdmin: true });
    expect(at("starter", 551).sendOwner).toBe(true);
    expect(at("pro", 2_751).flagAdmin).toBe(true);
  });

  it("once per billing period each — owner and operator tracked separately", () => {
    const period = may.toISOString();
    expect(at("backup", 400, { period, ownerWarnedAt: "x" })).toMatchObject({ sendOwner: false, flagAdmin: true });
    expect(at("backup", 400, { period, adminFlaggedAt: "x" })).toMatchObject({ sendOwner: true, flagAdmin: false });
    expect(at("backup", 400, { period, ownerWarnedAt: "x", adminFlaggedAt: "x" })).toMatchObject({
      over: true,
      sendOwner: false,
      flagAdmin: false,
    });
  });

  it("a new billing period starts clean", () => {
    const lastMonth = { period: "2026-04-03T00:00:00.000Z", ownerWarnedAt: "x", adminFlaggedAt: "x" };
    expect(at("backup", 400, lastMonth)).toMatchObject({ sendOwner: true, flagAdmin: true });
  });
});

describe("nextMinuteCapFlags", () => {
  it("adds marks within a period and keeps the earlier one", () => {
    const owner = nextMinuteCapFlags(undefined, may, { ownerWarnedAt: "a" });
    expect(owner).toEqual({ period: may.toISOString(), ownerWarnedAt: "a" });
    expect(nextMinuteCapFlags(owner, may, { adminFlaggedAt: "b" })).toEqual({
      period: may.toISOString(),
      ownerWarnedAt: "a",
      adminFlaggedAt: "b",
    });
  });
  it("drops last period's marks when the period rolls over", () => {
    const old = { period: may.toISOString(), ownerWarnedAt: "a", adminFlaggedAt: "b" };
    expect(nextMinuteCapFlags(old, june, {})).toEqual({ period: june.toISOString() });
  });
});

describe("countedSeconds — what counts toward the cap", () => {
  const rows = [
    { durationSec: 120, outcome: "booked", fromNumber: "+14155550101" },
    { durationSec: 600, outcome: "spam", fromNumber: "+18005550199" }, // robocall
    { durationSec: 300, outcome: "message", fromNumber: "+14155550142" }, // blocked by the owner
    { durationSec: null, outcome: "missed", fromNumber: "+14155550103" },
    { durationSec: 0, outcome: null, fromNumber: null },
    { durationSec: 61, outcome: null, fromNumber: null },
  ];
  it("skips robocalls, blocked callers and calls with no duration", () => {
    expect(countedSeconds(rows, ["+14155550142"])).toBe(181);
    expect(usedMinutesFromSeconds(181)).toBe(4);
  });
  it("with nothing blocked, the blocked caller's minutes count again", () => {
    expect(countedSeconds(rows, [])).toBe(481);
  });
  it("rounds partial minutes up and never goes negative", () => {
    expect(usedMinutesFromSeconds(0)).toBe(0);
    expect(usedMinutesFromSeconds(1)).toBe(1);
    expect(usedMinutesFromSeconds(-5)).toBe(0);
  });
});

describe("planThatFits", () => {
  it("suggests the smallest bigger plan that covers the usage, with its grace", () => {
    expect(planThatFits("backup", 300)).toBe("starter");
    expect(planThatFits("backup", 550)).toBe("starter");
    expect(planThatFits("backup", 551)).toBe("pro");
    expect(planThatFits("starter", 900)).toBe("pro");
  });
  it("nothing past Pro's fair-use line", () => {
    expect(planThatFits("starter", 2_751)).toBeNull();
    expect(planThatFits("pro", 3_000)).toBeNull();
  });
});

describe("owner email", () => {
  const base = {
    businessName: "Mission Plumbing",
    periodStart: may,
    periodEnd: june,
    plansUrl: "https://example.test/portal/settings#plan",
    questionsText: "Questions? Reply to this email.",
    questionsHtml: "Questions? Reply to this email.",
  };
  const rescue = renderOwnerCapEmail({ ...base, plan: "backup", usedMinutes: 240 });
  const pro = renderOwnerCapEmail({ ...base, plan: "pro", usedMinutes: 3_100 });

  it("says what happened, that nothing is cut off or charged, when it resets, and what fits", () => {
    expect(rescue.subject).toBe("Mission Plumbing: 240 minutes of calls since May 3");
    expect(rescue.text).toContain(`Your ${PLANS.backup.name} plan covers 200 minutes a month.`);
    expect(rescue.text).toContain("every call still gets answered, and there's no overage charge");
    expect(rescue.text).toContain("starts over on June 3");
    expect(rescue.text).toContain(`${PLANS.starter.name} covers 500 minutes a month`);
    expect(rescue.html).toContain('href="https://example.test/portal/settings#plan"');
  });

  it("Pro is described as fair use, and past it there's no plan to push", () => {
    expect(pro.text).toContain("a fair-use limit of 2,500 minutes a month");
    expect(pro.text).toContain("get in touch");
    expect(pro.text).not.toMatch(/unlimited/i);
  });

  it("escapes the business name in HTML", () => {
    const e = renderOwnerCapEmail({ ...base, businessName: "A & <B>", plan: "backup", usedMinutes: 240 });
    expect(e.html).toContain("A &amp; &lt;B&gt;");
    expect(e.html).not.toContain("<B>");
  });

  it("plain copy: no hype, no threats, no medical wording", () => {
    for (const s of [rescue.text, pro.text]) {
      expect(s).not.toMatch(/patient|clinic|medical|dental|unleash|seamless|supercharge|!|suspend|cut off/i);
    }
  });
});

describe("adminCapLine", () => {
  it("names the business, the numbers and what the owner was told", () => {
    const line = adminCapLine({ businessName: "Mission Plumbing", plan: "backup", usedMinutes: 240, ownerEmailed: true });
    expect(line).toContain("240 minutes");
    expect(line).toContain("200 included, alert at 220");
    expect(line).toContain(`nudge to ${PLANS.starter.name}`);
    expect(adminCapLine({ businessName: "X", plan: "pro", usedMinutes: 3_000, ownerEmailed: true })).toContain("Worth a call");
    expect(adminCapLine({ businessName: "X", plan: "pro", usedMinutes: 3_000, ownerEmailed: false })).toContain("didn't go out");
  });
});

describe("pricing copy", () => {
  it("Pro says fair use, not unlimited", () => {
    expect(minutesLabel(PLANS.pro)).toBe("Up to 2,500 min a month (fair use) · no overage charges");
    expect(minutesLabel(PLANS.backup)).toBe("200 minutes included · no overage charges");
    expect(minutesLabel(PLANS.starter)).toBe("500 minutes included · no overage charges");
    for (const p of Object.values(PLANS)) expect(minutesLabel(p)).not.toMatch(/unlimited/i);
  });
});

describe("landing FAQ minutes line", () => {
  it("lists every listed plan's minutes, Pro as fair use", async () => {
    const { minutesFaqLine } = await import("@/config/plans");
    expect(minutesFaqLine()).toBe(
      `${PLANS.backup.name} covers 200 minutes a month, ${PLANS.starter.name} 500, and ${PLANS.pro.name} up to 2,500 (fair use).`,
    );
  });
});
