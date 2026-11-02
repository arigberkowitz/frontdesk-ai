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
