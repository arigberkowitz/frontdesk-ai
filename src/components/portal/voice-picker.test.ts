import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/guidelines", () => ({ setVoiceByIdAction: vi.fn() }));

const { VoicePicker } = await import("./voice-picker");

const women = [{ voiceId: "11labs-Allie", name: "Allie", gender: "female", accent: "American", previewUrl: "https://x/a.mp3" }];
const men = [{ voiceId: "11labs-Adam", name: "Adam", gender: "male", accent: "British" }];

describe("VoicePicker", () => {
  it("has an explicit Save button that starts disabled (picking a row doesn't save)", () => {
    const html = renderToStaticMarkup(
      createElement(VoicePicker, { clientId: "c1", current: "11labs-Allie", women, men }),
    );
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>.*Save voice<\/button>/);
    expect(html).toContain("Nothing changes until you save.");
    expect(html).toContain("Speaking as");
    expect(html).toContain(">Allie<");
  });

  it("warns when the saved voice can't take calls", () => {
    const html = renderToStaticMarkup(
      createElement(VoicePicker, { clientId: "c1", current: "xai-Ara", women, men, unusableSavedName: "Ara" }),
    );
    expect(html).toContain("Ara (not available)");
    expect(html).toContain("isn&#x27;t available for phone calls");
  });
});
