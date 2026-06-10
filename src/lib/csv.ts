type Cell = string | number | boolean | null | undefined;

/** RFC-4180-ish CSV. Quotes cells containing commas, quotes, or newlines. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell): string => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((row) => row.map(esc).join(",")).join("\n");
}
