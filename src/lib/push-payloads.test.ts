import { describe, expect, it } from "vitest";
import {
  bookingPushPayload,
  deviceLabel,
  isAllowedPushEndpoint,
  testPushPayload,
  textPushPayload,
} from "./push-payloads";

describe("push payloads", () => {
  it("text: names the customer (or their number), links the thread, never carries the message", () => {
    expect(textPushPayload({ customerPhone: "+1 (415) 555-0100" })).toEqual({
      title: "New text from (415) 555-0100",
      body: "Tap to read and reply.",
      url: "/portal/messages/14155550100",
      tag: "text-14155550100",
    });
    expect(textPushPayload({ customerPhone: "14155550100", name: "Maria Lopez" }).title).toBe(
      "New text from Maria Lopez",
    );
    expect(textPushPayload({ customerPhone: "14155550100", aiReplying: true }).body).toMatch(/AI is answering/);
  });

  it("text: survives a missing number and caps a long name", () => {
    const p = textPushPayload({ customerPhone: "" });
    expect(p.title).toBe("New text from a customer");
    expect(p.url).toBe("/portal/messages");
    expect(textPushPayload({ customerPhone: "1", name: "x".repeat(80) }).title.length).toBeLessThan(60);
  });

  it("booking: who and when in the business's time zone, nothing about the service", () => {
    const p = bookingPushPayload({
      appointmentId: "a1",
      customerName: "Sam Patel",
      customerPhone: "+14155550100",
      startAt: new Date("2026-10-13T18:00:00Z"),
      timeZone: "America/New_York",
    });
    expect(p.title).toBe("New booking: Sam Patel");
    expect(p.body).toMatch(/2:00\s?PM/);
    expect(p.url).toBe("/portal/appointments");
    expect(p.tag).toBe("booking-a1");
    expect(bookingPushPayload({ appointmentId: "a2", startAt: new Date(), customerPhone: null }).title).toBe(
      "New booking: a customer",
    );
  });

  it("test notification points at the settings page", () => {
    expect(testPushPayload("Bright Smile").url).toBe("/portal/settings/alerts");
  });
});

describe("isAllowedPushEndpoint", () => {
  it("accepts the real push services", () => {
    for (const e of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://web.push.apple.com/QGx1",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://wns2-bl2p.notify.windows.com/w/?token=x",
    ]) {
      expect(isAllowedPushEndpoint(e), e).toBe(true);
    }
  });

  it("rejects anything the server shouldn't be calling", () => {
    for (const e of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://evil.example.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.com/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "not a url",
      "https://fcm.googleapis.com/" + "a".repeat(1100),
    ]) {
      expect(isAllowedPushEndpoint(e), e).toBe(false);
    }
  });
});

describe("deviceLabel", () => {
  it("names common devices", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      ),
    ).toBe("Android · Chrome");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
      ),
    ).toBe("Windows · Edge");
    expect(deviceLabel(null)).toBe("This device");
  });
});
