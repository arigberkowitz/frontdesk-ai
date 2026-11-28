/**
 * Every owner-controllable on/off feature in one list: what it's called, a
 * plain "What's this?" explainer, whether it's on, and what stops it.
 *
 * One catalog, used by the guided-setup "Choose your features" step
 * (Settings → Features) AND by the explainer dropdowns on the existing
 * switches in Settings and on the Overview, so the words never drift apart.
 *
 * Nothing here stores anything. Each switch posts the exact fields of the
 * EXISTING server action that already owns that setting (`featureFields`), so
 * there is still one source of truth per feature: flip it here and Settings /
 * Overview show the same value, and vice versa.
 *
 * Pure (no DB, no server-only) so the rules are unit-tested.
 */
import { switchboardFields } from "@/lib/ai-features";
import { MAX_LANGUAGES, parseLanguages, serializeLanguages } from "@/lib/languages";

export type FeatureToggleKey =
  | "transfer"
  | "transferOpenHoursOnly"
  | "offerHuman"
  | "spanish"
  | "staffMode"
  | "aiTextReplies"
  | "missedCallTexts"
  | "aiCallbacks"
  | "smartRebooking"
  | "recoveryTexts"
  | "reviewRequests"
  | "recall"
  | "waitlist"
  | "deposits"
  | "smsAlerts"
  | "weeklySummary"
  | "dailyBriefing"
  | "morningUnbookedText"
  | "chatWidget";

export type FeatureGroup = "calls" | "customerTexts" | "forYou" | "website";

export const FEATURE_GROUPS: { key: FeatureGroup; title: string; description: string }[] = [
  { key: "calls", title: "On calls", description: "How your AI handles the phone." },
  {
    key: "customerTexts",
    title: "Texts to your customers",
    description: "These only go to people who agreed to texts from you, and never after STOP.",
  },
  { key: "forYou", title: "Updates for you", description: "Texts and emails that only ever go to you." },
  { key: "website", title: "Your website", description: "Extras for your own site." },
];

export interface FeatureExplainer {
  /** What it does, in one or two plain sentences. */
  what: string;
  /** A concrete example. No numbers we can't stand behind. */
  example: string;
}

/**
 * The "What's this?" copy for every feature. Plain words, what it does plus an
 * example; no invented stats.
 */
export const FEATURE_EXPLAINERS: Record<FeatureToggleKey, FeatureExplainer> = {
  transfer: {
    what: "When a caller asks for a person, your AI puts the call through to your cell. Off: it takes a message and you call back.",
    example: "A caller says “Can I talk to the owner?” and your phone rings with them on the line.",
  },
  transferOpenHoursOnly: {
    what: "Transfers only happen during your business hours. After hours your AI takes a message instead, so your phone doesn't ring at night.",
    example: "Someone asks for you at 11pm. Your AI takes their name, number and reason, and you see it in the morning.",
  },
  offerHuman: {
    what: "Your AI offers to connect a caller to a person when they sound upset or the question is complicated, not only when they ask.",
    example: "A caller is frustrated about a bill, and your AI asks “Would you like me to connect you with someone on the team?”",
  },
  spanish: {
    what: "Your AI notices when a caller speaks Spanish and switches to Spanish for the rest of the call.",
    example: "A caller opens with “Hola, ¿tienen citas mañana?” and your AI answers and books in Spanish.",
  },
  staffMode: {
    what: "Your AI books with a specific team member, each person gets their own day view, and whoever is on the clock gets the alerts. Off: simple one-calendar booking.",
    example: "A caller asks for Maria, and your AI only offers times when Maria is free.",
  },
  aiTextReplies: {
    what: "When a customer texts your number, your AI answers from your services, hours and FAQs, and can book or move appointments. It hands the conversation to you when it isn't sure.",
    example: "A customer texts “Are you open Saturday?” and gets an answer with your Saturday hours.",
  },
  missedCallTexts: {
    what: "If a caller hangs up, gets cut off or leaves halfway through booking, we text them offering to finish by text.",
    example: "A caller drops off mid-booking and gets a text asking if they'd still like that appointment.",
  },
  aiCallbacks: {
    what: "Instead of a text, your AI phones the caller back from your number and says it's an AI. If the call doesn't connect, they get the text.",
    example: "Someone got cut off, and a few minutes later your AI calls them back to finish booking.",
  },
  smartRebooking: {
    what: "When you block off time that has bookings in it, you can have us text those customers a few new times to pick from. Nothing is sent until you press the button and confirm.",
    example: "You're out sick Thursday. Your Thursday customers each get new times and reply 1, 2 or 3 to move.",
  },
  recoveryTexts: {
    what: "Your AI follows up by text with leads that never booked and customers who missed an appointment. At most two gentle nudges, during your daytime hours only.",
    example: "Someone asked for a quote last week but never booked, and gets a friendly check-in text.",
  },
  reviewRequests: {
    what: "After a visit, we text the customer a thank-you and your review link.",
    example: "The day after a job, your customer gets “Thanks for choosing us! Mind leaving a quick review?” with your Google link.",
  },
  recall: {
    what: "When a customer is due for their next visit, we text and offer to book them again. It uses the “Book them again after” time you set on each service.",
    example: "A yearly tune-up customer gets a text when the year is up, asking if they'd like to book.",
  },
  waitlist: {
    what: "When your AI can't find a time that works, it offers to text the caller if something opens up. When a booking is cancelled, the people waiting for that time hear about it.",
    example: "A Friday slot gets cancelled, and the caller who wanted Friday gets a text offering it.",
  },
  deposits: {
    what: "Right after a booking that needs a deposit, we text the customer your own payment link. The money goes straight to you.",
    example: "A customer books a big job and immediately gets a text with your Square link for the deposit.",
  },
  smsAlerts: {
    what: "We text you the moment your AI books an appointment or takes a message. Email alerts always send either way.",
    example: "Your AI books a Tuesday appointment and your phone buzzes with the caller's name and time.",
  },
  weeklySummary: {
    what: "Every Monday, an email with last week's calls answered, bookings, missed calls won back and new leads.",
    example: "Monday morning you get one email showing how last week went.",
  },
  dailyBriefing: {
    what: "A short email each morning with yesterday's calls, who needs a call back and today's schedule, written from your call log.",
    example: "At breakfast you see two people need a call back and you have four bookings today.",
  },
  morningUnbookedText: {
    what: "A text each morning listing last night's after-hours callers who didn't book, with what they wanted and a link to each. No text when there's nobody.",
    example: "Two people called after you closed and didn't book. You get one text with both, so you can call them first thing.",
  },
  chatWidget: {
    what: "The same AI that answers your phone, as a chat bubble on your own website. It knows the same services, hours and answers.",
    example: "A visitor on your site types “Do you service my area?” and gets an answer right away.",
  },
};

/** Everything the list needs to know, read from the business's real settings. */
export interface FeatureFacts {
  handoffMode: "always" | "open_hours" | "never";
  escalationNumber: string | null;
  humanHandoffEnabled: boolean;
  languages: string | null;
  staffModeEnabled: boolean;
  /** The business's plan includes staff mode (Pro, trials, comped). */
  staffModeAllowed: boolean;
  aiTextRepliesEnabled: boolean;
  aiTextPauseHours: number;
  missedCallTextsEnabled: boolean;
  missedCallAiCallbacksEnabled: boolean;
  /** The platform switch (MISSED_CALL_AI_CALLBACKS) for AI phone call-backs. */
  aiCallbacksAvailable: boolean;
  smartRebookingEnabled: boolean;
  outboundRecoveryEnabled: boolean;
  reviewRequestsEnabled: boolean;
  reviewUrl: string | null;
  recallEnabled: boolean;
  /** Services with a "book them again after" interval. */
  recallServiceCount: number;
  waitlistEnabled: boolean;
  depositsEnabled: boolean;
  depositLinkUrl: string | null;
  smsAlertsEnabled: boolean;
  weeklySummaryEnabled: boolean;
  dailyBriefingEnabled: boolean;
  morningUnbookedTextEnabled: boolean;
  ownerEmail: string | null;
  chatWidgetEnabled: boolean;
  /** The business's plan includes website chat (Pro, trials, comped). Defaults to true when omitted. */
  chatWidgetAllowed?: boolean;
}

export interface FeatureRowView {
  key: FeatureToggleKey;
  group: FeatureGroup;
  title: string;
  /** One short line under the title. */
  summary: string;
  explainer: FeatureExplainer;
  on: boolean;
  /** Shown under a parent row, only while the parent is on. */
  parent?: FeatureToggleKey;
  /** Not on this plan: the switch is disabled and this says how to get it. */
  locked?: { note: string; href: string; label: string };
  /** Can't be turned ON yet because something is missing (the switch can still turn it off). */
  needs?: { note: string; href: string; label: string };
  /** Set somewhere else and can't be changed from this switch, either way. */
  fixed?: { note: string; href: string; label: string };
  /** On, but something stops it working right now. */
  warning?: { note: string; href?: string; label?: string };
  /** Shown once before switching ON — for anything that texts or calls customers. Null = no confirmation. */
  confirmNotes: string[] | null;
  /** Where the full settings for this feature live. */
  href: string;
}

/** Plain-language limits repeated in the confirmation notes. */
export interface FeatureLimits {
  repliesPerThreadPerDay: number;
  callbackDedupeDays: number;
  callbacksPerDay: number;
  rebookOfferHours: number;
}

const ALERTS = "/portal/settings/alerts";
const PHONE = "/portal/settings/phone";
const FOLLOW_UPS = "/portal/settings/follow-ups";

/** Confirmation notes for the features that text or call customers — shared with the Overview switchboard. */
export function confirmNotesFor(
  key: "aiTextReplies" | "missedCallTexts" | "aiCallbacks" | "smartRebooking",
  limits: FeatureLimits,
  opts: { bookingEnabled?: boolean } = {},
): string[] {
  switch (key) {
    case "aiTextReplies":
      return [
        "Only replies to people who texted you first, and never to anyone who texted STOP.",
        `Replies only between 9am and 8pm your time, at most ${limits.repliesPerThreadPerDay} AI texts per conversation a day.`,
        "Hands the conversation to you when someone asks for a person, it sounds urgent, or it isn't sure.",
        ...(opts.bookingEnabled === false
          ? ["No calendar is connected, so it answers questions but passes booking requests to you."]
          : []),
      ];
    case "missedCallTexts":
      return [
        "Only to callers who've agreed to texts from you, and never after STOP.",
        `One text per caller every ${limits.callbackDedupeDays} days, at most ${limits.callbacksPerDay} a day.`,
        "Sent 9am–8pm their time; a late-night call gets its text the next morning.",
      ];
    case "aiCallbacks":
      return [
        "Same rules as the texts: only callers who agreed to hear from you, 9am–8pm their time, never after STOP.",
        "The AI says it's an AI at the start of the call.",
      ];
    case "smartRebooking":
      return [
        "Nothing is sent until you press “Ask customers to rebook” on Hours and confirm.",
        "Only to customers who agreed to texts about their booking, never after STOP, 9am–8pm.",
        `Offers stay open ${limits.rebookOfferHours} hours; anything other than 1, 2, 3 or NO comes to you.`,
      ];
  }
}

export const STAFF_MODE_LOCKED_NOTE = "Included with Pro. Upgrade to book by team member.";
export const CHAT_WIDGET_LOCKED_NOTE = "Included with Pro. Upgrade to put your AI on your website.";

export function featureRows(
  f: FeatureFacts,
  limits: FeatureLimits,
  opts: { bookingEnabled?: boolean } = {},
): FeatureRowView[] {
  const hasNumber = Boolean(f.escalationNumber?.trim());
  const transferOn = f.handoffMode !== "never";
  const langs = parseLanguages(f.languages);
  const spanishPrimary = langs[0] === "es";
  const spanishOn = langs.includes("es");
  const ex = FEATURE_EXPLAINERS;
  const noNumber = { note: "Add your cell number in Alerts first. Until then your AI takes a message.", href: ALERTS, label: "Add a number" };

  const rows: FeatureRowView[] = [
    {
      key: "transfer",
      group: "calls",
      title: "Put callers through to you",
      summary: "Transfer a caller to your cell when they ask for a person.",
      explainer: ex.transfer,
      on: transferOn,
      warning: transferOn && !hasNumber ? noNumber : undefined,
      confirmNotes: null,
      href: PHONE,
    },
    {
      key: "transferOpenHoursOnly",
      group: "calls",
      parent: "transfer",
      title: "Only while you're open",
      summary: "After hours, take a message instead of ringing you.",
      explainer: ex.transferOpenHoursOnly,
      on: f.handoffMode === "open_hours",
      confirmNotes: null,
      href: PHONE,
    },
    {
      key: "offerHuman",
      group: "calls",
      parent: "transfer",
      title: "Offer a person when it helps",
      summary: "Offer to connect upset or complicated callers, even if they don't ask.",
      explainer: ex.offerHuman,
      on: f.humanHandoffEnabled,
      confirmNotes: null,
      href: PHONE,
    },
    {
      key: "spanish",
      group: "calls",
      title: "Answer in Spanish too",
      summary: "Switch to Spanish when a caller speaks it.",
      explainer: ex.spanish,
      on: spanishOn,
      fixed: spanishPrimary
        ? { note: "Your calls open in Spanish. Change the opening language in Phone & AI.", href: PHONE, label: "Languages" }
        : undefined,
      needs: !spanishOn && langs.length >= MAX_LANGUAGES
          ? { note: `You already have ${MAX_LANGUAGES} languages. Remove one in Phone & AI first.`, href: PHONE, label: "Languages" }
          : undefined,
      confirmNotes: null,
      href: PHONE,
    },
    {
      key: "staffMode",
      group: "calls",
      title: "Book by team member",
      summary: "Book with a specific person, with a day view for each.",
      explainer: ex.staffMode,
      on: f.staffModeEnabled,
      // Plan-gated: shown, not hidden. An owner already on it can still switch it off.
      locked: !f.staffModeAllowed && !f.staffModeEnabled
        ? { note: STAFF_MODE_LOCKED_NOTE, href: "/portal/guidelines#plans", label: "See plans" }
        : undefined,
      confirmNotes: null,
      href: "/portal/staff",
    },
    {
      key: "aiTextReplies",
      group: "customerTexts",
      title: "AI text replies",
      summary: "Answer customer texts and book by text.",
      explainer: ex.aiTextReplies,
      on: f.aiTextRepliesEnabled,
      confirmNotes: confirmNotesFor("aiTextReplies", limits, opts),
      href: FOLLOW_UPS,
    },
    {
      key: "missedCallTexts",
      group: "customerTexts",
      title: "Missed-call text-back",
      summary: "Text callers who hung up or got cut off.",
      explainer: ex.missedCallTexts,
      on: f.missedCallTextsEnabled,
      confirmNotes: confirmNotesFor("missedCallTexts", limits),
      href: FOLLOW_UPS,
    },
    ...(f.aiCallbacksAvailable
      ? [
          {
            key: "aiCallbacks",
            group: "customerTexts",
            parent: "missedCallTexts",
            title: "AI calls them back instead",
            summary: "Phone them back from your number instead of texting.",
            explainer: ex.aiCallbacks,
            on: f.missedCallTextsEnabled && f.missedCallAiCallbacksEnabled,
            confirmNotes: confirmNotesFor("aiCallbacks", limits),
            href: FOLLOW_UPS,
          } satisfies FeatureRowView,
        ]
      : []),
    {
      key: "smartRebooking",
      group: "customerTexts",
      title: "Smart rebooking",
      summary: "Offer new times when you block time over bookings.",
      explainer: ex.smartRebooking,
      on: f.smartRebookingEnabled,
      confirmNotes: confirmNotesFor("smartRebooking", limits),
      href: FOLLOW_UPS,
    },
    {
      key: "recoveryTexts",
      group: "customerTexts",
      title: "Recovery texts",
      summary: "Follow up with leads who didn't book and no-shows.",
      explainer: ex.recoveryTexts,
      on: f.outboundRecoveryEnabled,
      confirmNotes: [
        "At most two follow-up texts per person, during your daytime hours only.",
        "Every text shows on your Leads page. Marking a lead won or lost stops the follow-ups.",
      ],
      href: FOLLOW_UPS,
    },
    {
      key: "reviewRequests",
      group: "customerTexts",
      title: "Ask for reviews",
      summary: "Text customers your review link after a visit.",
      explainer: ex.reviewRequests,
      on: f.reviewRequestsEnabled,
      needs: !f.reviewRequestsEnabled && !f.reviewUrl?.trim()
        ? { note: "Add your review link first.", href: FOLLOW_UPS, label: "Add link" }
        : undefined,
      confirmNotes: null,
      href: FOLLOW_UPS,
    },
    {
      key: "recall",
      group: "customerTexts",
      title: "Invite customers back",
      summary: "Text customers when they're due for their next visit.",
      explainer: ex.recall,
      on: f.recallEnabled,
      needs: !f.recallEnabled && f.recallServiceCount === 0
        ? { note: "Set “Book them again after” on a service first.", href: "/portal/services", label: "Services" }
        : undefined,
      confirmNotes: null,
      href: FOLLOW_UPS,
    },
    {
      key: "waitlist",
      group: "customerTexts",
      title: "Keep a waitlist",
      summary: "Text people waiting when a time opens up.",
      explainer: ex.waitlist,
      on: f.waitlistEnabled,
      confirmNotes: null,
      href: FOLLOW_UPS,
    },
    {
      key: "deposits",
      group: "customerTexts",
      title: "Take a deposit",
      summary: "Text your payment link after a booking that needs one.",
      explainer: ex.deposits,
      on: f.depositsEnabled,
      needs: !f.depositsEnabled && !f.depositLinkUrl?.trim()
        ? { note: "Add your payment link first.", href: FOLLOW_UPS, label: "Add link" }
        : undefined,
      confirmNotes: null,
      href: FOLLOW_UPS,
    },
    {
      key: "smsAlerts",
      group: "forYou",
      title: "Text alerts",
      summary: "Text you on every booking and message.",
      explainer: ex.smsAlerts,
      on: f.smsAlertsEnabled,
      warning: f.smsAlertsEnabled && !hasNumber ? { note: "Add a phone number in Alerts to get these.", href: ALERTS, label: "Add a number" } : undefined,
      confirmNotes: null,
      href: ALERTS,
    },
    {
      key: "weeklySummary",
      group: "forYou",
      title: "Weekly summary email",
      summary: "A recap of last week, every Monday.",
      explainer: ex.weeklySummary,
      on: f.weeklySummaryEnabled,
      warning: f.weeklySummaryEnabled && !f.ownerEmail?.trim() ? { note: "Add an alerts email to get this.", href: ALERTS, label: "Add an email" } : undefined,
      confirmNotes: null,
      href: ALERTS,
    },
    {
      key: "dailyBriefing",
      group: "forYou",
      title: "Morning briefing email",
      summary: "Yesterday's calls and today's schedule, each morning.",
      explainer: ex.dailyBriefing,
      on: f.dailyBriefingEnabled,
      warning: f.dailyBriefingEnabled && !f.ownerEmail?.trim() ? { note: "Add an alerts email to get this.", href: ALERTS, label: "Add an email" } : undefined,
      confirmNotes: null,
      href: ALERTS,
    },
    {
      key: "morningUnbookedText",
      group: "forYou",
      title: "Morning text: who didn't book",
      summary: "Last night's after-hours callers who didn't book.",
      explainer: ex.morningUnbookedText,
      on: f.morningUnbookedTextEnabled,
      warning: f.morningUnbookedTextEnabled && !f.smsAlertsEnabled
        ? { note: "Text alerts are off, so this can't be sent. Turn on Text alerts above." }
        : undefined,
      confirmNotes: null,
      href: ALERTS,
    },
    {
      key: "chatWidget",
      group: "website",
      title: "Chat on your website",
      summary: "Your AI as a chat bubble on your site.",
      explainer: ex.chatWidget,
      on: f.chatWidgetEnabled,
      // Pro only: shown, not hidden. An owner already on it can still switch it off.
      locked: f.chatWidgetAllowed === false && !f.chatWidgetEnabled
        ? { note: CHAT_WIDGET_LOCKED_NOTE, href: `${FOLLOW_UPS}#website-chat`, label: "Upgrade to Pro" }
        : undefined,
      warning: f.chatWidgetAllowed === false && f.chatWidgetEnabled
        ? { note: "Paused on your website until you're on Pro. Your settings are saved." }
        : undefined,
      confirmNotes: null,
      href: `${FOLLOW_UPS}#website-chat`,
    },
  ];
  return rows;
}

/**
 * The exact fields each switch posts to the feature's EXISTING server action,
 * shaped like that feature's own Settings form. Keep in step with:
 *  - transfer / transferOpenHoursOnly → setHandoffModeAction (`mode`)
 *  - offerHuman, recoveryTexts, smsAlerts, weeklySummary, spanish,
 *    dailyBriefing, morningUnbookedText → savePortalProfileAction (patches only what's sent)
 *  - staffMode → setStaffModeAction (`enabled` = "true" | "false")
 *  - AI features → the same fields as the Overview switchboard
 *  - growth features → their save actions; the link they need is re-sent as saved
 */
export function featureFields(
  key: FeatureToggleKey,
  clientId: string,
  on: boolean,
  f: FeatureFacts,
): Record<string, string> {
  const onOff = (name: string) => ({ clientId, [name]: on ? "on" : "off" });
  const checked = (): Record<string, string> => (on ? { clientId, enabled: "on" } : { clientId });
  switch (key) {
    case "transfer":
      // Back on = the default ("whenever they ask"); narrow it with "Only while you're open".
      return { clientId, mode: on ? "always" : "never" };
    case "transferOpenHoursOnly":
      return { clientId, mode: on ? "open_hours" : "always" };
    case "offerHuman":
      return onOff("humanHandoffEnabled");
    case "spanish": {
      const langs = parseLanguages(f.languages);
      const next = on ? [...langs.filter((c) => c !== "es"), "es"] : langs.filter((c) => c !== "es");
      return { clientId, languages: serializeLanguages(next.length ? next : ["en"]) };
    }
    case "staffMode":
      return { clientId, enabled: on ? "true" : "false" };
    case "aiTextReplies":
      return switchboardFields("aiTextReplies", clientId, on, { pauseHours: f.aiTextPauseHours });
    case "missedCallTexts":
    case "smartRebooking":
    case "dailyBriefing":
    case "morningUnbookedText":
      return switchboardFields(key, clientId, on);
    case "aiCallbacks":
      return switchboardFields("aiCallbacks", clientId, on);
    case "recoveryTexts":
      return onOff("outboundRecoveryEnabled");
    case "smsAlerts":
      return onOff("smsAlertsEnabled");
    case "weeklySummary":
      return onOff("weeklySummaryEnabled");
    case "reviewRequests":
      return { ...checked(), reviewUrl: f.reviewUrl ?? "" };
    case "deposits":
      return { ...checked(), depositLinkUrl: f.depositLinkUrl ?? "" };
    case "recall":
    case "waitlist":
    case "chatWidget":
      return checked();
  }
}

/**
 * Applies a saved switch to the facts, so rows that depend on another switch
 * (sub-switches, warnings) update without a reload. Mirrors what the server
 * action saves.
 */
export function applyFeatureChange(f: FeatureFacts, key: FeatureToggleKey, on: boolean): FeatureFacts {
  switch (key) {
    case "transfer":
      return { ...f, handoffMode: on ? "always" : "never" };
    case "transferOpenHoursOnly":
      return { ...f, handoffMode: on ? "open_hours" : "always" };
    case "offerHuman":
      return { ...f, humanHandoffEnabled: on };
    case "spanish":
      return { ...f, languages: featureFields("spanish", "", on, f).languages };
    case "staffMode":
      return { ...f, staffModeEnabled: on };
    case "aiTextReplies":
      return { ...f, aiTextRepliesEnabled: on };
    case "missedCallTexts":
      // The server clears the AI call-back whenever the main switch changes.
      return { ...f, missedCallTextsEnabled: on, missedCallAiCallbacksEnabled: false };
    case "aiCallbacks":
      return { ...f, missedCallTextsEnabled: true, missedCallAiCallbacksEnabled: on };
    case "smartRebooking":
      return { ...f, smartRebookingEnabled: on };
    case "recoveryTexts":
      return { ...f, outboundRecoveryEnabled: on };
    case "reviewRequests":
      return { ...f, reviewRequestsEnabled: on };
    case "recall":
      return { ...f, recallEnabled: on };
    case "waitlist":
      return { ...f, waitlistEnabled: on };
    case "deposits":
      return { ...f, depositsEnabled: on };
    case "smsAlerts":
      return { ...f, smsAlertsEnabled: on };
    case "weeklySummary":
      return { ...f, weeklySummaryEnabled: on };
    case "dailyBriefing":
      return { ...f, dailyBriefingEnabled: on };
    case "morningUnbookedText":
      return { ...f, morningUnbookedTextEnabled: on };
    case "chatWidget":
      return { ...f, chatWidgetEnabled: on };
  }
}
