/**
 * The first-run setup checklist: which steps exist, what "done" means for each,
 * and when the card shows. Pure — the facts come from real data in
 * `data/setup.ts` — so the rules are testable without a database.
 */

export interface SetupStep {
  key: string;
  label: string;
  href: string;
  done: boolean;
  hint?: string;
  /** Shown once the step is ticked — for when "done" doesn't mean what it looks like. */
  doneHint?: string;
  /** Can be resolved with "skip for now" (calendar). */
  skippable?: boolean;
  /** Resolved by the owner confirming they did it outside the app (forwarding). */
  manual?: boolean;
}

/** Manual checklist state kept in `clients.setup_flags`. */
export interface SetupFlags {
  calendarSkipped?: boolean;
  forwardingDone?: boolean;
  /** ISO time the owner hid the unfinished checklist from the Overview. */
  checklistHiddenAt?: string;
}

/** Counts and fields the checklist is derived from — all read from real data. */
export interface SetupFacts {
  services: number;
  /** Days with an open window in business_hours. */
  openDays: number;
  faqs: number;
  greeting: string | null | undefined;
  calendarConnected: boolean;
  alertContacts: number;
  ownerEmail: string | null | undefined;
  agentId: string | null | undefined;
  /** Formatted AI phone number, or null if none yet. */
  aiNumber: string | null;
  calls: number;
  flags: SetupFlags;
}

export function buildSetupSteps(f: SetupFacts): SetupStep[] {
  const flags = f.flags;
  const aiNumber = f.aiNumber;
  return [
    { key: "services", label: "Add your services", href: "/portal/services", done: f.services > 0 },
    { key: "hours", label: "Set your hours", href: "/portal/hours", done: f.openDays > 0 },
    {
      key: "faqs",
      label: "Add a few FAQs",
      href: "/portal/knowledge",
      done: f.faqs > 0,
      hint: "Teach it the questions callers ask.",
    },
    {
      key: "greeting",
      label: "Set your greeting & voice",
      href: "/portal/guidelines",
      done: Boolean(f.greeting?.trim()),
    },
    {
      key: "calendar",
      label: "Connect your calendar",
      href: "/portal/appointments",
      done: f.calendarConnected || Boolean(flags.calendarSkipped),
      skippable: true,
      hint: "So the AI can book appointments — or skip for now and it takes messages.",
      // A skipped calendar is a ticked step that means the opposite of what a
      // tick usually means: your AI will never book anybody. Say so on the
      // ticked row, where they'll actually read it.
      doneHint:
        !f.calendarConnected && flags.calendarSkipped
          ? "Skipped — your AI takes messages instead of booking anyone in. Connect anytime."
          : undefined,
    },
    {
      key: "alerts",
      label: "Choose who gets alerts",
      href: "/portal/settings",
      done: f.alertContacts > 0 || Boolean(f.ownerEmail?.trim()),
      hint: "Who we text or email when a lead or emergency comes in.",
    },
    {
      key: "live",
      label: "Activate your receptionist",
      href: "/portal/guidelines",
      // An agent without a number cannot answer a phone. Provisioning the
      // number is deliberately allowed to fail without losing the agent, which
      // is right — but this step used to go green on the agent alone, so the
      // one step that actually mattered showed a tick next to a receptionist
      // no one could ring.
      done: Boolean(f.agentId && aiNumber),
      // "Agent sync" needs no step of its own: every save in Services, Hours,
      // Knowledge and Your AI republishes the live agent (applyClientEdit), and
      // says so in the save message if it couldn't.
      doneHint: f.agentId && aiNumber
        ? "Live. Your AI picks up changes automatically whenever you save in Services, Hours, Knowledge or Your AI."
        : undefined,
      hint: f.agentId && !aiNumber
        ? "Your AI is built but hasn't been given a phone number yet. Tell us and we'll sort it — nothing else here works until it has one."
        : "Go live — this is when your business gets its own AI phone number.",
    },
    {
      key: "forwarding",
      label: "Forward your business line",
      href: "/portal/settings#forwarding",
      done: Boolean(flags.forwardingDone),
      // "I've done this" only exists once there's a number to have forwarded
      // to. It was clickable before then, and clicking it said "Forwarding
      // confirmed — calls to your business line now reach your AI", which was
      // a sentence about a phone number that did not exist.
      manual: Boolean(aiNumber),
      // Every business gets its own dedicated AI number at activation — show
      // the real one here the moment it exists instead of "your AI number".
      hint: aiNumber
        ? `From your business phone, dial *72 ${aiNumber} (most carriers; AT&T/T-Mobile: **21*${aiNumber.replace(/[^\d+]/g, "")}#). ~2 minutes, undo with *73.`
        : "The dial code contains your AI's own phone number, so it appears here once that number is assigned. Until then, try your AI with a test call in your browser (Your AI page).",
    },
    {
      key: "testcall",
      label: "Make a test call — hear it answer",
      // The hint tells you to use the browser test call, which lives on Your AI.
      // Sending you to the (empty) call log instead was a dead end at the exact
      // moment you were trying to do the thing.
      href: "/portal/guidelines#test-call",
      done: f.calls > 0,
      hint: aiNumber
        ? `Call your AI at ${aiNumber}. This checks itself off when your first call appears.`
        : "No number yet? Use “Test call in browser” on the Your AI page. This checks itself off when your first call appears.",
    },
  ];
}

export type ChecklistMode =
  /** Render nothing. */
  | "hidden"
  /** Setup finished, but the AI review left suggestions worth one more look. */
  | "notes"
  /** The full checklist. */
  | "checklist";

/**
 * Whether/how the checklist renders.
 *
 *  - Overview: shows for every business until setup is finished ("I'm done"),
 *    unless the owner hid it with "Hide for now". After finishing, only the AI
 *    review's suggestions (if any) remain.
 *  - Settings → Setup: always the full checklist — it's where a hidden or
 *    finished checklist lives on, and where it's brought back.
 */
export function checklistMode(opts: {
  variant: "overview" | "settings";
  finishedAt: string | Date | null;
  hiddenAt: string | null | undefined;
  reviewNotes: number;
}): ChecklistMode {
  if (opts.variant === "settings") return "checklist";
  if (opts.finishedAt) return opts.reviewNotes > 0 ? "notes" : "hidden";
  if (opts.hiddenAt) return "hidden";
  return "checklist";
}
