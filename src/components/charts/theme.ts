/** Shared chart styling so every graph in the app reads as one set. */
export const CHART_COLORS = {
  calls: "#6366f1", // indigo
  bookings: "#10b981", // emerald
  // call outcomes
  booked: "#10b981",
  answered: "#3b82f6",
  message: "#6366f1",
  missed: "#94a3b8",
  other: "#cbd5e1",
} as const;

export const CHART_GRID = "var(--border)";
export const CHART_AXIS = "var(--muted-foreground)";

/** Identical Recharts tooltip across all charts. */
export const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  fontSize: 12,
  padding: "8px 12px",
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.10)",
} as const;
