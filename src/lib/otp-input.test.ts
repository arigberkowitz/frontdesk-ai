import { describe, expect, it } from "vitest";
import { applyCodeInput } from "./otp-input";

const empty = ["", "", "", "", "", ""];

describe("applyCodeInput", () => {
  it("advances on a single digit", () => {
    expect(applyCodeInput(empty, 0, "4")).toEqual({ code: ["4", "", "", "", "", ""], focus: 1 });
  });
  it("fills every box from a full paste or autofill, from any box", () => {
    expect(applyCodeInput(empty, 0, "123456").code).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(applyCodeInput(empty, 3, "123 456").code).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(applyCodeInput(empty, 0, "12-34-56").focus).toBe(5);
  });
  it("spreads a partial paste from the current box", () => {
    expect(applyCodeInput(empty, 2, "789").code).toEqual(["", "", "7", "8", "9", ""]);
  });
  it("replaces when typing over a filled box", () => {
    const c = ["1", "2", "", "", "", ""];
    expect(applyCodeInput(c, 1, "25")).toEqual({ code: ["1", "5", "", "", "", ""], focus: 2 });
  });
  it("clears on delete and ignores letters", () => {
    expect(applyCodeInput(["1", "", "", "", "", ""], 0, "").code[0]).toBe("");
    expect(applyCodeInput(empty, 0, "ab").code).toEqual(empty);
  });
});
