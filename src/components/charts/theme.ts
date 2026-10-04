/** Shared chart styling so every graph in the app reads as one set. */
export const CHART_COLORS = {
  calls: "#6a3df5", // Signal violet
  bookings: "#10b981", // emerald
  // call outcomes
  booked: "#10b981",
  answered: "#0891b2", // Signal cyan
  message: "#6a3df5",
  escalated: "#f59e0b",
  missed: "#94a3b8",
  other: "#cbd5e1",
} as const;

export const CHART_GRID = "var(--border)";
export const CHART_AXIS = "var(--muted-foreground)";
export const CHART_AXIS_FONT_SIZE = 11;

/** Identical Recharts tooltip across all charts. Rendered as HTML, so CSS vars resolve. */
export const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
  padding: "8px 12px",
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.10)",
} as const;
