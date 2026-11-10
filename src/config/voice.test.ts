import { describe, expect, it } from "vitest";
import { cleanVoiceLabel, groupVoicesByGender, type VoiceMeta } from "./voice";

describe("cleanVoiceLabel", () => {
  it("splits a parenthetical accent out of the name", () => {
    expect(cleanVoiceLabel({ voiceId: "a", name: "Amy(UK)", gender: "female" })).toMatchObject({ name: "Amy", accent: "British" });
  });
  it("fixes vendor typos", () => {
    expect(cleanVoiceLabel({ voiceId: "b", name: "Lucas", accent: "Brazilian Portugese" }).accent).toBe("Brazilian Portuguese");
  });
});

describe("groupVoicesByGender", () => {
  const voices: VoiceMeta[] = [
    { voiceId: "11labs-Adrian", name: "Adrian", gender: "male", accent: "American" },
    { voiceId: "openai-Adrian", name: "Adrian", gender: "female" },
    { voiceId: "11labs-Leland", name: "Leland", gender: "male" },
    { voiceId: "cartesia-Leland", name: "Leland", gender: "male", previewUrl: "x" },
    { voiceId: "x-Max", name: "Max", gender: "male" },
    { voiceId: "y-Max", name: "Max ", gender: "male", accent: "British" },
    { voiceId: "amy", name: "Amy(UK)", gender: "female" },
  ];
  const { women, men } = groupVoicesByGender(voices, "11labs-Adrian");
  const all = [...women, ...men];
  it("lists every name once, in one bucket", () => {
    expect(all.map((v) => v.name).sort()).toEqual(["Adrian", "Amy", "Leland", "Max"]);
  });
  it("keeps the current voice under its own gender", () => {
    expect(men.find((v) => v.name === "Adrian")?.voiceId).toBe("11labs-Adrian");
    expect(women.some((v) => v.name === "Adrian")).toBe(false);
  });
  it("prefers a voice with a sample clip", () => {
    expect(men.find((v) => v.name === "Leland")?.voiceId).toBe("cartesia-Leland");
  });
});

describe("engine-incompatible (xAI) voices", () => {
  it("isUsableVoiceId / isUsableVoice", async () => {
    const { isUsableVoiceId, isUsableVoice } = await import("./voice");
    expect(isUsableVoiceId("xai-Ara")).toBe(false);
    expect(isUsableVoiceId("XAI-aurora")).toBe(false);
    expect(isUsableVoiceId("")).toBe(false);
    expect(isUsableVoiceId("11labs-Marissa")).toBe(true);
    expect(isUsableVoiceId("openai-Alloy")).toBe(true);
    expect(isUsableVoice({ voiceId: "custom-1", provider: "xai" })).toBe(false);
  });
  it("are left out of the Women / Men lists, even when saved", () => {
    const { women, men } = groupVoicesByGender(
      [
        { voiceId: "xai-Ara", name: "Ara", gender: "female" },
        { voiceId: "xai-Altair", name: "Altair", gender: "male" },
        { voiceId: "11labs-Allie", name: "Allie", gender: "female", accent: "American" },
      ],
      "xai-Ara",
    );
    expect(women.map((v) => v.name)).toEqual(["Allie"]);
    expect(men).toEqual([]);
  });
});

describe("voicePickerSummary", () => {
  it("asks for Save only once a new voice is picked", async () => {
    const { voicePickerSummary } = await import("./voice");
    const clean = voicePickerSummary({ savedName: "Allie", selectedName: "Allie", dirty: false });
    expect(clean).toMatchObject({ speakingAs: "Allie", dirty: false, warning: null });
    const picked = voicePickerSummary({ savedName: "Allie", selectedName: "Adam", dirty: true });
    expect(picked.hint).toBe("Adam selected — click Save to use it on calls.");
  });
  it("flags a saved voice that can't take calls", async () => {
    const { voicePickerSummary } = await import("./voice");
    const s = voicePickerSummary({ savedName: null, selectedName: null, dirty: false, unusableSavedName: "Ara" });
    expect(s.speakingAs).toBe("Ara (not available)");
    expect(s.warning).toMatch(/Ara isn't available for phone calls/);
  });
});
