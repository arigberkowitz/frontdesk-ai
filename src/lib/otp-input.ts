/**
 * Spread whatever landed in one box of a 6-box code field across the boxes.
 * Covers a single keystroke, typing over a filled box, a paste of the whole
 * code (with spaces or dashes), and iOS/Android "one-time-code" autofill,
 * which drops all six digits into the first box at once.
 */
export function applyCodeInput(
  code: readonly string[],
  index: number,
  value: string,
): { code: string[]; focus: number } {
  const next = [...code];
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    next[index] = "";
    return { code: next, focus: index };
  }
  // Typing over a filled box gives "old+new": keep the new digit.
  const incoming = digits.length === 2 && code[index] && digits.startsWith(code[index]) ? digits.slice(1) : digits;
  // A full code pasted anywhere fills from the first box.
  const start = incoming.length >= next.length ? 0 : index;
  let i = start;
  for (const d of incoming) {
    if (i >= next.length) break;
    next[i++] = d;
  }
  return { code: next, focus: Math.min(i, next.length - 1) };
}
