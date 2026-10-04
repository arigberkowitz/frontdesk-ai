/**
 * The operator's "Today" inbox: everything across the portfolio that needs a
 * person, each item pointing at the page where it gets done.
 *
 * Pure aggregation — counts in, sorted items out — so the rules are unit
 * tested without a database. The counts come from cheap grouped queries over
 * existing tables (src/lib/data/today-inbox.ts); nothing here adds storage.
 */

export type InboxKind =
  | "unread_sms"
  | "new_leads"
  | "failed_sends"
  | "trial_ending"
  | "proposed_fixes"
  | "open_grades"
  | "failed_runs";

export type InboxTone = "action" | "warning" | "info";

export interface InboxItem {
  key: string;
  kind: InboxKind;
  tone: InboxTone;
  clientId: string | null;
  clientName: string | null;
  /** The number shown in the item's badge. */
  count: number;
  title: string;
  detail: string;
  href: string;
  /** Short call to action ("Reply", "Review"…), also used as the link's label. */
  cta: string;
}

export interface ClientCount {
  clientId: string;
  count: number;
}

export interface InboxCounts {
  /** Leads still in status `new`, per client. */
  newLeads: ClientCount[];
  /** Conversations (distinct customer numbers) with an unread inbound text, per client. */
  unreadThreads: ClientCount[];
  /** Improve-agent suggestions in status `proposed`, per client. */
  proposedFixes: ClientCount[];
  /** QA grades still `open`, per client. One /review item covers them all. */
  openGrades: ClientCount[];
  /** Clients on a trial whose trial ends within the window (or already ended). */
  trialsEnding: { clientId: string; trialEndsAt: Date }[];
  /** Reminders with status `failed` in the window, per client. */
  failedReminders: ClientCount[];
  /** Outbound texts with status `failed` in the window, per client. */
  failedTexts: ClientCount[];
  /** Agent runs with status `failed` in the window, per client. */
  failedRuns: ClientCount[];
}

export const EMPTY_INBOX_COUNTS: InboxCounts = {
  newLeads: [],
  unreadThreads: [],
  proposedFixes: [],
  openGrades: [],
  trialsEnding: [],
  failedReminders: [],
  failedTexts: [],
  failedRuns: [],
};

/** Order the inbox reads in: customers waiting first, housekeeping last. */
const KIND_ORDER: InboxKind[] = [
  "unread_sms",
  "new_leads",
  "failed_sends",
  "trial_ending",
  "proposed_fixes",
  "open_grades",
  "failed_runs",
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Portal-only actions open the operator's portal preview of that client. */
export function portalPreviewHref(clientId: string, portalPath: string): string {
  return `/clients/${clientId}/preview-portal?next=${encodeURIComponent(portalPath)}`;
}

/**
 * Where the preview entry point may land: a /portal path only. Anything else
 * (another origin, `//evil.test`, a non-portal page, a backslash trick) falls
 * back to the portal home, so `next` can never become an open redirect.
 */
export function resolvePortalPreviewNext(next: string | null | undefined): string {
  if (!next) return "/portal";
  if (!/^\/portal(?:[/?#]|$)/.test(next)) return "/portal";
  if (next.includes("\\") || next.includes("//")) return "/portal";
  return next;
}

export function clientTabHref(clientId: string, tab: string): string {
  return `/clients/${clientId}?tab=${tab}`;
}

function daysUntil(when: Date, now: Date): number {
  return Math.ceil((when.getTime() - now.getTime()) / 86_400_000);
}

function trialDetail(endsAt: Date, now: Date): string {
  const d = daysUntil(endsAt, now);
  if (d < 0) return `Trial ended ${plural(-d, "day")} ago and is still marked trial`;
  if (d === 0) return "Trial ends today";
  if (d === 1) return "Trial ends tomorrow";
  return `Trial ends in ${d} days`;
}

export function buildTodayInbox(
  clients: { id: string; name: string }[],
  counts: InboxCounts,
  now: Date = new Date(),
): { items: InboxItem[]; total: number } {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const items: InboxItem[] = [];
  // Rows for a client outside this list (deleted, other org) are dropped.
  const known = <T extends { clientId: string }>(rows: T[]) => rows.filter((r) => names.has(r.clientId));
  const positive = (rows: ClientCount[]) => known(rows).filter((r) => r.count > 0);

  for (const r of positive(counts.unreadThreads)) {
    items.push({
      key: `unread_sms:${r.clientId}`,
      kind: "unread_sms",
      tone: "action",
      clientId: r.clientId,
      clientName: names.get(r.clientId)!,
      count: r.count,
      title: plural(r.count, "unread text thread"),
      detail: "A customer texted and nobody has opened it yet",
      href: portalPreviewHref(r.clientId, "/portal/messages"),
      cta: "Reply",
    });
  }

  for (const r of positive(counts.newLeads)) {
    items.push({
      key: `new_leads:${r.clientId}`,
      kind: "new_leads",
      tone: "action",
      clientId: r.clientId,
      clientName: names.get(r.clientId)!,
      count: r.count,
      title: plural(r.count, "new lead"),
      detail: "Captured on a call, not contacted yet",
      href: clientTabHref(r.clientId, "leads"),
      cta: "Follow up",
    });
  }

  // A reminder that fails by text is ALSO logged as a failed outbound text,
  // so the two counts can describe the same send. The badge shows the larger
  // of the two (never their sum); the detail line names both.
  const reminders = new Map(positive(counts.failedReminders).map((r) => [r.clientId, r.count]));
  const texts = new Map(positive(counts.failedTexts).map((r) => [r.clientId, r.count]));
  for (const clientId of new Set([...reminders.keys(), ...texts.keys()])) {
    const rem = reminders.get(clientId) ?? 0;
    const txt = texts.get(clientId) ?? 0;
    const parts = [rem ? plural(rem, "reminder") : null, txt ? plural(txt, "text") : null].filter(Boolean);
    items.push({
      key: `failed_sends:${clientId}`,
      kind: "failed_sends",
      tone: "warning",
      clientId,
      clientName: names.get(clientId)!,
      count: Math.max(rem, txt),
      title: "Texts or reminders failed",
      detail: `${parts.join(" · ")} failed in the last 7 days`,
      href: portalPreviewHref(clientId, "/portal/messages"),
      cta: "Check",
    });
  }

  for (const t of known(counts.trialsEnding)) {
    const d = daysUntil(t.trialEndsAt, now);
    items.push({
      key: `trial_ending:${t.clientId}`,
      kind: "trial_ending",
      tone: d <= 2 ? "warning" : "info",
      clientId: t.clientId,
      clientName: names.get(t.clientId)!,
      count: Math.max(d, 0),
      title: d < 0 ? "Trial overdue" : "Trial ending soon",
      detail: trialDetail(t.trialEndsAt, now),
      href: clientTabHref(t.clientId, "settings"),
      cta: "Billing",
    });
  }

  for (const r of positive(counts.proposedFixes)) {
    items.push({
      key: `proposed_fixes:${r.clientId}`,
      kind: "proposed_fixes",
      tone: "action",
      clientId: r.clientId,
      clientName: names.get(r.clientId)!,
      count: r.count,
      title: `${plural(r.count, "agent fix", "agent fixes")} awaiting approval`,
      detail: "Drafted by the improvement loop — nothing ships until approved",
      href: portalPreviewHref(r.clientId, "/portal"),
      cta: "Approve",
    });
  }

  const grades = positive(counts.openGrades).sort((a, b) => b.count - a.count);
  const gradeTotal = grades.reduce((s, r) => s + r.count, 0);
  if (gradeTotal > 0) {
    const who = grades.map((g) => `${names.get(g.clientId)} (${g.count})`);
    items.push({
      key: "open_grades",
      kind: "open_grades",
      tone: "action",
      clientId: null,
      clientName: null,
      count: gradeTotal,
      title: `${plural(gradeTotal, "QA grade")} to review`,
      detail: who.length > 3 ? `${who.slice(0, 3).join(" · ")} +${who.length - 3} more` : who.join(" · "),
      href: "/review",
      cta: "Review",
    });
  }

  for (const r of positive(counts.failedRuns)) {
    items.push({
      key: `failed_runs:${r.clientId}`,
      kind: "failed_runs",
      tone: "warning",
      clientId: r.clientId,
      clientName: names.get(r.clientId)!,
      count: r.count,
      title: `${plural(r.count, "agent run")} failed`,
      detail: "In the last 7 days — check the agent and the logs",
      href: clientTabHref(r.clientId, "agent"),
      cta: "Open",
    });
  }

  items.sort((a, b) => {
    const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (k !== 0) return k;
    if (a.kind === "trial_ending") return a.count - b.count; // soonest first
    return b.count - a.count || (a.clientName ?? "").localeCompare(b.clientName ?? "");
  });

  return { items, total: items.length };
}
