import { describe, expect, it } from "vitest";
import { locationFieldsForSave, serviceLocation, videoProviderLabel } from "./service-location";
import { serviceSchema } from "./validation";

describe("serviceLocation", () => {
  it("defaults to in person", () => {
    expect(serviceLocation(undefined)).toEqual({ type: "in_person", videoProvider: null });
    expect(serviceLocation({})).toEqual({ type: "in_person", videoProvider: null });
  });
  it("a service saved before location types (virtualOk, no type) is video on the calendar's own link", () => {
    expect(serviceLocation({ virtualOk: true })).toEqual({ type: "video", videoProvider: "meet" });
    expect(serviceLocation({ virtualOk: true, locationType: null })).toEqual({ type: "video", videoProvider: "meet" });
  });
  it("an explicit type wins over the old flag", () => {
    expect(serviceLocation({ locationType: "in_person", virtualOk: true }).type).toBe("in_person");
    expect(serviceLocation({ locationType: "phone" })).toEqual({ type: "phone", videoProvider: null });
    expect(serviceLocation({ locationType: "video", videoProvider: "zoom" })).toEqual({ type: "video", videoProvider: "zoom" });
    expect(serviceLocation({ locationType: "video", videoProvider: "weird" }).videoProvider).toBe("meet");
  });
});

describe("locationFieldsForSave", () => {
  it("keeps virtual_ok in step and drops the provider when it isn't video", () => {
    expect(locationFieldsForSave({ locationType: "video", videoProvider: "zoom" })).toEqual({
      locationType: "video",
      videoProvider: "zoom",
      virtualOk: true,
    });
    expect(locationFieldsForSave({ locationType: "video" }).videoProvider).toBe("meet");
    expect(locationFieldsForSave({ locationType: "phone", videoProvider: "zoom" })).toEqual({
      locationType: "phone",
      videoProvider: null,
      virtualOk: false,
    });
  });
});

describe("labels and validation", () => {
  it("names the built-in link by calendar", () => {
    expect(videoProviderLabel("meet", "google")).toBe("Google Meet");
    expect(videoProviderLabel("meet", "microsoft")).toBe("Microsoft Teams");
    expect(videoProviderLabel("zoom", "google")).toBe("Zoom");
  });
  it("the service form accepts the three types and rejects anything else", () => {
    const base = { name: "Consult" };
    expect(serviceSchema.parse({ ...base, locationType: "video", videoProvider: "zoom" }).locationType).toBe("video");
    expect(serviceSchema.parse(base).locationType).toBe("in_person");
    expect(serviceSchema.safeParse({ ...base, locationType: "teleport" }).success).toBe(false);
  });
});
