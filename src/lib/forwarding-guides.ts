/**
 * "How do I forward my phone line?" for the phone services businesses actually
 * use. Every step below comes from the vendor's own help page (linked as
 * `sources`), checked 2026-11-27. Rules for editing this file:
 *
 *  - Never invent a menu path or a code. If the vendor doesn't document it, say
 *    so in `checkWithProvider` and tell the owner to ask them.
 *  - Where a vendor can't do something we need (Google Voice, Spectrum by
 *    phone, ...), say so plainly. A guide that quietly doesn't work is worse
 *    than one that says "ask your provider".
 *  - Placeholders: {num} = the AI number as (415) 555-0100, {dial} = its ten
 *    digits, {e164} = +14155550100, {gsm} = the number as AT&T/T-Mobile want it
 *    after a star code (+1…).
 */
export type GuideMode = "all_calls" | "missed_only";

export interface GuideSource {
  label: string;
  url: string;
}

export interface GuideSteps {
  /** Short steps, in order. May use the placeholders above. */
  steps: string[];
  /** One honest line when the vendor's docs are thin or don't cover this. */
  checkWithProvider?: string;
}

export interface ForwardingGuide {
  id: string;
  label: string;
  group: "mobile" | "office";
  /** Forward every call (plan mode "Every call"). */
  always: GuideSteps;
  /** Forward only busy / no-answer calls (plan mode "Only calls you miss"). */
  missed: GuideSteps;
  sources: GuideSource[];
}

export const GUIDES_CHECKED_ON = "2026-11-27";

export const FORWARDING_GUIDES: ForwardingGuide[] = [
  {
    id: "att",
    label: "AT&T (mobile)",
    group: "mobile",
    always: {
      steps: [
        "On the AT&T phone, open the dialer and dial **21*{dial}# then press Call.",
        "Wait at least three seconds for the confirmation tone before you hang up.",
        "To turn it off, dial ##21# (AT&T's own page lists #21#, use that if ##21# is rejected).",
      ],
      checkWithProvider:
        "AT&T says wireless call forwarding can only be changed from the phone itself, not online. Forwarding overrides your AT&T voicemail.",
    },
    missed: {
      steps: [
        "Dial **61*{dial}# for calls you don't answer, then **67*{dial}# for calls that come in while you're on the phone. Dial each one separately and wait for the confirmation.",
        "To turn them off, dial ##61# and ##67#.",
      ],
      checkWithProvider:
        "AT&T's own wireless page documents only forward-every-call. The no-answer and busy codes above are the standard ones AT&T phones use (Google's help page shows them for AT&T as *61*number# and *67*number#). If AT&T rejects them, call AT&T and ask: 'Please turn on conditional call forwarding for my line.'",
    },
    sources: [
      { label: "AT&T: Call forwarding for wireless", url: "https://www.att.com/support/article/wireless/KM1011513/" },
      { label: "AT&T: Call forwarding codes", url: "https://www.att.com/device-support/article/147973/" },
      { label: "Google Voice Help: conditional forwarding codes (AT&T example)", url: "https://support.google.com/voice/answer/165656" },
    ],
  },
  {
    id: "tmobile",
    label: "T-Mobile (mobile)",
    group: "mobile",
    always: {
      steps: [
        "On the T-Mobile phone, dial **21*1{dial}# then press Call.",
        "To turn it off, dial ##21#.",
      ],
      checkWithProvider:
        "T-Mobile shows the number as 1 plus ten digits. Metro by T-Mobile and Mint Mobile publish their own rules, so check with them if the code is rejected.",
    },
    missed: {
      steps: [
        "Dial **61*1{dial}# for calls you don't answer, then **67*1{dial}# for calls that come in while you're on the phone.",
        "Optional: choose how long your phone rings first by adding ** and 5 to 30 seconds before the #, like **61*1{dial}**20#.",
        "To turn them off, dial ##61# and ##67#. ##004# puts everything back to T-Mobile voicemail.",
      ],
    },
    sources: [
      { label: "T-Mobile Support: Self-service & short codes", url: "https://www.t-mobile.com/support/plans-features/self-service-short-codes" },
      { label: "T-Mobile Support: Calling services", url: "https://www.t-mobile.com/support/plans-features/calling-services" },
    ],
  },
  {
    id: "verizon",
    label: "Verizon (mobile)",
    group: "mobile",
    always: {
      steps: [
        "On the Verizon phone, dial *72 followed by {dial}, then press Call.",
        "Listen for a series of beeps, then wait for the call to end on its own.",
        "To turn it off, dial *73.",
      ],
      checkWithProvider:
        "Verizon says star codes may not work outside Verizon coverage. If *72 doesn't work, Verizon customer service can switch forwarding on or off for you.",
    },
    missed: {
      steps: [
        "On the Verizon phone, dial *71 followed by {dial}, then press Call. Verizon calls this Conditional Call Forwarding (No Answer / Busy).",
        "Listen for a series of beeps, then wait for the call to end on its own. Calls forward when your phone is busy or you don't answer after about 3 to 6 rings.",
        "To turn it off, dial *73.",
      ],
      checkWithProvider:
        "On a Verizon home or office landline (Fios Digital Voice) the codes are different: *90 busy and *92 no answer, turned off with *91 and *93.",
    },
    sources: [
      { label: "Verizon: Turn Call Forwarding On from Device", url: "https://www.verizon.com/support/knowledge-base-181139/" },
      { label: "Verizon: Call Forwarding, everything you need to know", url: "https://www.verizon.com/articles/verizon-unlimited-plans/call-forwarding-everything-you-need-to-know/" },
      { label: "Verizon Fios: star codes", url: "https://www.verizon.com/support/residential/homephone/calling-features/star-codes-other-features" },
    ],
  },
  {
    id: "ringcentral",
    label: "RingCentral",
    group: "office",
    always: {
      steps: [
        "In the RingCentral app (desktop or web), open Settings, then Phone.",
        "Under Incoming calls, open Forward all calls. RingCentral lists an extension, voicemail or an announcement as the places it can send them.",
        "To send every call to an outside number, set Missed calls (below) to forward to the AI number and use the shortest ring time you can.",
      ],
      checkWithProvider:
        "RingCentral's page for Forward all calls doesn't name outside numbers as a destination. Ask RingCentral support to confirm the best way to send every call to an outside number on your plan.",
    },
    missed: {
      steps: [
        "In the RingCentral app (desktop or web), open Settings, then Phone, then Call handling, and click Edit.",
        "Pick Work hours (and After hours if you use them). Under Incoming calls, set how long your phone rings before a call counts as missed.",
        "Under Missed calls, choose Forward to external number and enter {num}.",
        "Click Save.",
      ],
      checkWithProvider:
        "Calls that arrive while you're already on a call follow this missed-call rule only when Call waiting is turned off (Settings, Phone, Call waiting). RingCentral admins can also change a user's settings in the Admin Portal.",
    },
    sources: [
      { label: "RingCentral: Setting up user call forwarding (desktop and web)", url: "https://support.ringcentral.com/shared/content/app/setting-up-user-call-forwarding-in-the-ringcentral-app-desktop-a.html" },
      { label: "RingCentral: Managing phone settings", url: "https://support.ringcentral.com/article-v2/Managing-phone-settings.html?brand=RingCentral&language=en_US&pills-nav=desktop_%26_web&product=RingEX" },
      { label: "RingCentral: Incoming call handling settings", url: "https://support.ringcentral.com/article-v2/Setting-up-how-incoming-calls-are-handled.html?brand=RingCentral&language=en_US&pills-nav=mobile&product=RingEX" },
    ],
  },
  {
    id: "comcast",
    label: "Comcast Business VoiceEdge",
    group: "office",
    always: {
      steps: [
        "On a phone on your Comcast line, dial *72 and follow the voice prompts to enter {dial}.",
        "To turn it off, dial *73.",
      ],
      checkWithProvider:
        "The same forwarding options are in Comcast Business My Account under Call Forwarding. Menu names can differ by account, so ask Comcast if your screen doesn't match.",
    },
    missed: {
      steps: [
        "On a phone on your Comcast line, dial *90 and enter {dial} to forward calls that come in while you're on the phone. Turn off with *91.",
        "Then dial *92 and enter {dial} to forward calls nobody answers. Turn off with *93.",
      ],
      checkWithProvider:
        "If your phones are in a hunt group, ask Comcast which setup fits. Busy and no-answer forwarding can behave differently there.",
    },
    sources: [
      { label: "Comcast Business VoiceEdge star codes (PDF)", url: "http://d6e9167053f2e044d76b-d8a82dbdce1015b18225f9d5a7588c5d.r65.cf2.rackcdn.com/uploaded/b/0e9545198_1574358272_bve-star-codes.pdf" },
    ],
  },
  {
    id: "spectrum",
    label: "Spectrum Business Voice",
    group: "office",
    always: {
      steps: [
        "On a phone on your Spectrum line, press *72.",
        "Listen for the dial tone, enter {dial}, and wait for the confirmation announcement.",
        "To turn it off, press *73 and wait for the confirmation tone.",
      ],
      checkWithProvider:
        "Spectrum warns that calls keep forwarding and skip voicemail until you turn forwarding off.",
    },
    missed: {
      steps: [
        "Spectrum says forward-when-busy and forward-when-no-answer can only be set in the Spectrum Business Voice Manager portal, not by phone.",
        "Sign in to the Voice Manager portal as your account administrator and look for Call Forward Busy and Call Forward No Answer for your line.",
        "Enter {dial} as the number and choose how many rings before a call forwards, then save.",
      ],
      checkWithProvider:
        "Spectrum's guide doesn't give the exact portal menu names, so if you can't find them, ask Spectrum support to set busy and no-answer forwarding to {num}.",
    },
    sources: [
      { label: "Spectrum Business Voice user guide (PDF)", url: "https://enterprise.spectrum.com/content/dam/spectrum/enterprise/en/pdfs/support/user-guides/spectrum-business-voice-user-guide.pdf" },
    ],
  },
  {
    id: "googlevoice",
    label: "Google Voice",
    group: "office",
    always: {
      steps: [
        "Google Voice rings the phones you link to your number: in the Voice app, Settings, Account, Devices and numbers, New linked number.",
        "Google sends a verification code by text or phone call to the linked number, and your AI number can't read one back.",
        "Google also says forwarding Google Voice calls to an automated system is unsupported.",
      ],
      checkWithProvider:
        "Because of both of those, Google Voice isn't a reliable way to reach your AI. Check with Google, or talk to us about moving your number to a phone service that can forward.",
    },
    missed: {
      steps: [
        "Google Voice rings every linked phone on each call. It doesn't have a forward-only-when-busy-or-unanswered setting.",
        "Google's help page says to set busy and no-answer forwarding on the linked mobile phone's carrier instead. If that phone is on AT&T, T-Mobile or Verizon, use that carrier's guide.",
        "Google also says forwarding Google Voice calls to an automated system is unsupported.",
      ],
      checkWithProvider:
        "Check with Google, or talk to us about moving your number to a phone service that can forward.",
    },
    sources: [
      { label: "Google Voice Help: set up your phone (linked numbers)", url: "https://support.google.com/voice/answer/165221" },
      { label: "Google Voice Help: conditional call forwarding", url: "https://support.google.com/voice/answer/165656" },
    ],
  },
  {
    id: "grasshopper",
    label: "Grasshopper",
    group: "office",
    always: {
      steps: [
        "Sign in to Grasshopper and go to Settings, then Call Forwarding Settings, then Extensions.",
        "Click edit next to your extension (or create one).",
        "Enter {num} as the only number to ring, and save.",
      ],
      checkWithProvider:
        "Grasshopper's page doesn't spell out every label on the screen, so follow what you see there.",
    },
    missed: {
      steps: [
        "Sign in to Grasshopper and go to Settings, then Call Forwarding Settings, then Extensions.",
        "Click edit next to your extension. Add your own phone first, then add {num} second.",
        "Choose to call the numbers in order if there is no answer (not at the same time), and save.",
      ],
      checkWithProvider:
        "Grasshopper's page says you can call numbers in order if there is no answer. Test it once by calling and not picking up.",
    },
    sources: [
      { label: "Grasshopper: call forwarding", url: "https://grasshopper.com/features/call-forwarding" },
    ],
  },
  {
    id: "vonage",
    label: "Vonage Business",
    group: "office",
    always: {
      steps: [
        "Admin: sign in to the Admin Portal, click Phone System, then Extensions, hover over the extension and click the pencil icon.",
        "Click Call Forwarding and turn Forward Calls on, then choose Send To Ext. Or Number and enter {num}.",
        "Save. (A user can do this in their Online Account: avatar, Settings, Call Forwarding, Forward All Calls.)",
      ],
      checkWithProvider:
        "Vonage says forwarded calls ring for the time you set, and if no one answers they go to voicemail.",
    },
    missed: {
      steps: [
        "Vonage's Forward Calls option sends incoming calls to the number you enter. For ring-me-first handling, Vonage has Follow Me: in the same Call Forwarding screen it rings up to five extensions or numbers in the order you set.",
        "Put your own phone first, set the number of rings, and add {num} after it.",
      ],
      checkWithProvider:
        "Vonage doesn't describe Follow Me as a forward-when-unanswered feature, so ask Vonage to confirm it does what you want, or ask them to forward busy and unanswered calls to {num}.",
    },
    sources: [
      { label: "Vonage Business Cloud: Forward Call Options", url: "https://businesssupport.vonage.com/app/articles/answer/Never-Miss-a-Call-24810" },
    ],
  },
  {
    id: "8x8",
    label: "8x8",
    group: "office",
    always: {
      steps: [
        "Admin: log in to the 8x8 Admin Console and click Users.",
        "Click the pencil icon next to the extension, select Call forwarding rules, and click the pencil to edit.",
        "Under Forward all Calls, choose Selected User or Service, enter {e164} (with the country code), and click Save.",
        "Then save the user profile.",
      ],
      checkWithProvider:
        "8x8 says to include the country code when forwarding to an external number.",
    },
    missed: {
      steps: [
        "Admin: log in to the 8x8 Admin Console and click Users.",
        "Click the pencil icon next to the extension, select Call forwarding rules, and click the pencil to edit.",
        "Under When User is Busy and When User does not Answer the Call, choose Selected Users or External Numbers (or Forward Directly To) and enter {e164}. For no answer, enter how many seconds it rings first.",
        "Click Save, then save the user profile.",
      ],
    },
    sources: [
      { label: "8x8: Set up call forwarding in 8x8 Admin Console", url: "https://help.8x8.com/docs/set-up-call-forwarding-in-8x8-admin-console" },
    ],
  },
  {
    id: "ooma",
    label: "Ooma",
    group: "office",
    always: {
      steps: [
        "From a phone on your Ooma line, dial *72{dial}# to forward every call.",
        "To turn it off, dial *73.",
      ],
    },
    missed: {
      steps: [
        "From a phone on your Ooma line, dial *77 to switch forward-if-no-answer on. Dial it again to switch it off.",
      ],
      checkWithProvider:
        "Ooma's star-code page lists *77 as 'Toggle call forward if no answer' but doesn't say how to set the number it forwards to. Ask Ooma support to set no-answer forwarding to {num}. There is no busy-forward code on that page.",
    },
    sources: [
      { label: "Ooma: star codes for analog phones", url: "https://www.ooma.com/small-business-phone-systems/setup-support/star-codes-for-analog-phones/" },
    ],
  },
  {
    id: "nextiva",
    label: "Nextiva",
    group: "office",
    always: {
      steps: [
        "From the user's phone, dial *72, enter {dial} when prompted, press #, and wait for the message to finish.",
        "To turn it off, dial *73.",
        "Or in the voice portal as an administrator: Users, Manage Users, pick the user, expand Forwarding, then Call Forwarding Always. Enter {dial} (no dashes or spaces), click Save, then switch it On.",
      ],
      checkWithProvider:
        "Nextiva says this forwards direct calls to the user only, not calls from a call center or call group.",
    },
    missed: {
      steps: [
        "Log in to the voice portal as an administrator and click Users.",
        "Hover over the user, click Actions, then Voice Settings, then Forwarding.",
        "Expand Call forwarding (unanswered), enter {dial}, choose the number of rings, and click Save.",
        "For busy calls, expand Call forwarding (busy) on the same screen, enter {dial}, choose the rings, and Save.",
      ],
      checkWithProvider:
        "Nextiva says these rules only forward direct calls to the user, not calls from a call center or call group.",
    },
    sources: [
      { label: "Nextiva: Call Forwarding Always", url: "https://help.nextiva.com/article/call-forwarding-always-np3" },
      { label: "Nextiva: Call Forward No Answer", url: "https://help.nextiva.com/article/call-forward-no-answer" },
      { label: "Nextiva: Call Forward Busy", url: "https://help.nextiva.com/article/call-forward-busy" },
    ],
  },
  {
    id: "dialpad",
    label: "Dialpad",
    group: "office",
    always: {
      steps: [
        "Admin: in Dialpad Admin Settings open Office, then Main Line, then Business Hours & Call Routing, then Edit Call Routing.",
        "Choose No operator, then To a team member, room phone or number, and enter {num}.",
        "Save.",
      ],
      checkWithProvider:
        "Dialpad says sending calls to a number outside Dialpad needs Dialpad Support to enable it for your account first. Contact them before you start.",
    },
    missed: {
      steps: [
        "For your own Dialpad line: go to Your Settings, then Call Handling & Voicemail, then Show Advanced Options. Set the Ring duration.",
        "Under Advanced missed call routing, choose To a team member, room phone or external number and enter {num}.",
        "For the shared Main Line: Admin Settings, Office, Main Line, Business Hours & Call Routing, Edit Call Routing, Operators, Fallback Options, then choose the external number.",
      ],
      checkWithProvider:
        "Dialpad says sending calls outside Dialpad needs Dialpad Support to enable it for your account first.",
    },
    sources: [
      { label: "Dialpad: Set a custom ring duration", url: "https://help.dialpad.com/hc/en-us/articles/55072364227611-Set-a-Custom-Ring-Duration" },
      { label: "Dialpad: Manage a Main Line", url: "https://help.dialpad.com/hc/en-us/articles/55007679123227-Manage-a-Main-Line" },
    ],
  },
  {
    id: "other",
    label: "Other / not sure",
    group: "office",
    always: {
      steps: [
        "Call your phone provider (the company on your bill) and say: 'Forward all calls on my business number to {num}.'",
        "They can switch it on from their side. Ask them how to turn it off again, too.",
        "Some providers have a settings page or star codes. On most landlines, *72 turns forwarding on and *73 turns it off.",
      ],
      checkWithProvider: "Codes and menus differ by provider. If one doesn't work, ask them.",
    },
    missed: {
      steps: [
        "Call your phone provider (the company on your bill) and say: 'Forward my busy and unanswered calls to {num}.'",
        "They can switch it on from their side. Ask them how to turn it off again, too.",
        "On many landlines *90 forwards when busy and *92 when nobody answers, turned off with *91 and *93.",
      ],
      checkWithProvider: "Codes and menus differ by provider. If one doesn't work, ask them.",
    },
    sources: [
      { label: "Verizon Fios: star codes (an example of landline codes)", url: "https://www.verizon.com/support/residential/homephone/calling-features/star-codes-other-features" },
    ],
  },
];

export function findGuide(id: string): ForwardingGuide | undefined {
  return FORWARDING_GUIDES.find((g) => g.id === id);
}

/** Fill the placeholders for one AI number. */
export function fillGuideText(text: string, aiNumber: string): string {
  const digits = aiNumber.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const pretty = ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : aiNumber;
  const e164 = ten.length === 10 ? `+1${ten}` : aiNumber;
  return text
    .replaceAll("{num}", pretty)
    .replaceAll("{dial}", ten)
    .replaceAll("{e164}", e164)
    .replaceAll("{gsm}", e164);
}

export function guideFor(
  guide: ForwardingGuide,
  mode: GuideMode,
  aiNumber: string,
): { steps: string[]; checkWithProvider?: string } {
  const g = mode === "missed_only" ? guide.missed : guide.always;
  return {
    steps: g.steps.map((s) => fillGuideText(s, aiNumber)),
    checkWithProvider: g.checkWithProvider ? fillGuideText(g.checkWithProvider, aiNumber) : undefined,
  };
}
