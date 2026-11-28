import { describe, expect, it } from "vitest";
import {
  cleanVoiceLabel,
  groupVoicesByGender,
  isElevenLabsVoice,
  isVoiceCompatibleWithLanguages,
  pinCurrentVoice,
  voicesForAgent,
  type VoiceMeta,
} from "./voice";

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

describe("language-compatible voices", () => {
  it("treats 11labs- ids as ElevenLabs", () => {
    expect(isElevenLabsVoice({ voiceId: "11labs-Marissa" })).toBe(true);
    expect(isElevenLabsVoice({ voiceId: "cartesia-Allie", provider: "cartesia" })).toBe(false);
    expect(isElevenLabsVoice({ voiceId: "Allie", provider: "elevenlabs" })).toBe(true);
  });

  it("hides Cartesia/OpenAI voices when the agent speaks more than English", () => {
    const allie = { voiceId: "cartesia-Allie", name: "Allie", provider: "cartesia" };
    const marissa = { voiceId: "11labs-Marissa", name: "Marissa", provider: "elevenlabs" };
    expect(isVoiceCompatibleWithLanguages(allie, "en")).toBe(true);
    expect(isVoiceCompatibleWithLanguages(allie, "en-es")).toBe(false);
    expect(isVoiceCompatibleWithLanguages(allie, "en,es,fr")).toBe(false);
    expect(isVoiceCompatibleWithLanguages(marissa, "en-es")).toBe(true);
    expect(isVoiceCompatibleWithLanguages({ voiceId: "xai-Ara" }, "en")).toBe(false);
  });

  it("voicesForAgent drops Cartesia on a multilingual agent, keeps Marissa, and pins the current voice first", () => {
    const live: VoiceMeta[] = [
      { voiceId: "cartesia-Allie", name: "Allie", gender: "female", accent: "American", provider: "cartesia", previewUrl: "x" },
      { voiceId: "11labs-Allie", name: "Allie", gender: "female", accent: "American", provider: "elevenlabs" },
      { voiceId: "openai-Ballad", name: "Ballad", gender: "male", provider: "openai" },
      { voiceId: "11labs-Amy", name: "Amy", gender: "female", accent: "British", provider: "elevenlabs" },
    ];
    const { women, men } = voicesForAgent(live, { currentVoiceId: "11labs-Marissa", languages: "en-es" });
    expect(women.map((v) => v.voiceId)[0]).toBe("11labs-Marissa");
    expect(women.map((v) => v.name)).toContain("Allie");
    expect(women.find((v) => v.name === "Allie")?.voiceId).toBe("11labs-Allie");
    expect(women.some((v) => v.voiceId.startsWith("cartesia-"))).toBe(false);
    expect(men.map((v) => v.voiceId)).toEqual(["11labs-Adrian"]);
  });

  it("English-only agents can still pick a Cartesia voice", () => {
    const { women } = voicesForAgent(
      [{ voiceId: "cartesia-Allie", name: "Allie", gender: "female", provider: "cartesia" }],
      { currentVoiceId: "11labs-Marissa", languages: "en" },
    );
    expect(women.find((v) => v.voiceId === "cartesia-Allie")).toBeTruthy();
    expect(women[0]?.voiceId).toBe("11labs-Marissa");
  });

  it("pinCurrentVoice moves the saved voice to the top without losing it", () => {
    const amy = { voiceId: "11labs-Amy", name: "Amy", gender: "female" };
    const marissa = { voiceId: "11labs-Marissa", name: "Marissa", gender: "female" };
    const { women } = pinCurrentVoice({ women: [amy, marissa], men: [] }, "11labs-Marissa");
    expect(women.map((v) => v.name)).toEqual(["Marissa", "Amy"]);
  });
});
