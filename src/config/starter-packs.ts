import { INDUSTRIES } from "@/config/options";

/**
 * Industry starter packs: real, editable content a brand-new business starts
 * with — typical services and hours, and guardrails tuned to the industry's
 * risks (a dental office fields toothache emergencies; a plumber fields gas
 * leaks). Services are seeded without prices so the AI won't quote a number
 * the owner never set. Knowledge-base answers are not seeded: factual claims
 * (licenses, insurance, guarantees, prices) must come from the owner, via
 * the starter-question chips on the knowledge page.
 *
 * Pure config (no DB, no server-only) so tests and client components can
 * import it. Seeding happens in `src/lib/starter-seed.ts`.
 */

export interface StarterService {
  name: string;
  durationMin: number;
  /** null = "varies" — the AI quotes nothing and offers a follow-up instead. */
  priceCents: number | null;
  description: string;
}

export interface StarterFaq {
  question: string;
  answer: string;
}

export interface StarterHours {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  isClosed: boolean;
  openTime: string; // "HH:MM"
  closeTime: string;
}

export interface StarterPack {
  /** Exact match against the stored `clients.industry` value (see INDUSTRIES). */
  industry: (typeof INDUSTRIES)[number] | null;
  services: StarterService[];
  faq: StarterFaq[];
  hours: StarterHours[];
  guardrails: string;
  booking: string;
}

/** A full week of hours: open/close every day except `closedDays`. */
function week(openTime: string, closeTime: string, closedDays: number[]): StarterHours[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isClosed: closedDays.includes(dayOfWeek),
    openTime,
    closeTime,
  }));
}

const BASE_GUARDRAILS =
  "Always be warm, polite, and professional. Only answer using the information in this profile — if " +
  "you're not sure about a price, availability, or a policy, offer to take a message and have someone " +
  "follow up. Never make up details.";

/** Generic fallback — the pack every unmatched industry starts from. */
export const DEFAULT_PACK: StarterPack = {
  industry: null,
  services: [
    { name: "Consultation", durationMin: 30, priceCents: null, description: "An intro call to understand what the customer needs." },
    { name: "Standard appointment", durationMin: 60, priceCents: null, description: "Your most common service." },
    { name: "Follow-up visit", durationMin: 30, priceCents: null, description: "A shorter check-in for returning customers." },
  ],
  faq: [],
  hours: week("09:00", "17:00", [0, 6]),
  guardrails: BASE_GUARDRAILS + " Never give medical, legal, or financial advice.",
  booking:
    "Offer the next available openings during business hours. Before booking, confirm the service, the " +
    "date and time, and the caller's name and phone number, then read the appointment back to them.",
};

export const STARTER_PACKS: StarterPack[] = [
  {
    industry: "Dental",
    services: [
      { name: "New patient exam & X-rays", durationMin: 60, priceCents: null, description: "Comprehensive first visit: full exam, X-rays, and a treatment plan." },
      { name: "Cleaning & checkup", durationMin: 60, priceCents: null, description: "Routine hygiene cleaning with a doctor's checkup." },
      { name: "Teeth whitening", durationMin: 90, priceCents: null, description: "In-office professional whitening session." },
      { name: "Emergency visit", durationMin: 30, priceCents: null, description: "Same-day slot for tooth pain, a broken tooth, or swelling. Cost depends on treatment." },
    ],
    faq: [],
    hours: week("08:00", "17:00", [0, 6]),
    guardrails:
      BASE_GUARDRAILS +
      " Never diagnose or give dental or medical advice over the phone. If a caller describes severe " +
      "pain, facial swelling, or an injury, treat it as urgent: offer the first same-day emergency slot " +
      "and flag the booking as an emergency. If swelling affects breathing or swallowing, tell them to " +
      "call 911 or go to the ER immediately.",
    booking:
      "Ask whether they're a new or returning patient — new patients book the new patient exam. Confirm " +
      "the visit type, date and time, and the patient's name and phone number, then read it back. Remind " +
      "them to bring their insurance card.",
  },
  {
    industry: "Law",
    services: [
      { name: "Case evaluation", durationMin: 15, priceCents: null, description: "A short call to understand the matter and whether we can help." },
      { name: "Initial consultation", durationMin: 45, priceCents: null, description: "An in-depth meeting with an attorney to review your case and options." },
      { name: "Document review", durationMin: 60, priceCents: null, description: "An attorney reviews your contract or documents. Quoted after the evaluation." },
    ],
    faq: [],
    hours: week("09:00", "17:00", [0, 6]),
    guardrails:
      BASE_GUARDRAILS +
      " Never give legal advice, predict the outcome of a case, or quote fees for specific legal work — " +
      "only an attorney can do that. Don't say whether the firm will take a case. Collect the caller's " +
      "situation in their own words and book the evaluation or take a detailed message.",
    booking:
      "For new matters, book the case evaluation first. Confirm the date and time, the caller's " +
      "name and phone number, and a one-line description of the matter, then read the consultation back " +
      "to them.",
  },
  {
    industry: "Salon & beauty",
    services: [
      { name: "Haircut", durationMin: 30, priceCents: null, description: "Cut, style, and finish." },
      { name: "Haircut & beard trim", durationMin: 45, priceCents: null, description: "Full cut plus beard shaping and line-up." },
      { name: "Color", durationMin: 120, priceCents: null, description: "Single-process color. Longer or corrective work is quoted in person." },
      { name: "Kids' cut", durationMin: 30, priceCents: null, description: "Cut for kids 12 and under." },
    ],
    faq: [],
    hours: week("09:00", "19:00", [0, 1]),
    guardrails:
      BASE_GUARDRAILS +
      " Color and corrective work varies a lot — don't invent a price; say the stylist will confirm " +
      "in person.",
    booking:
      "Ask if they'd like a specific stylist or barber, then book with that person. Confirm the service, " +
      "who it's with, the date and time, and the caller's name and phone number, then read it back.",
  },
  {
    industry: "Med spa",
    services: [
      { name: "Consultation", durationMin: 30, priceCents: null, description: "A consultation to build your treatment plan — required before injectables." },
      { name: "Signature facial", durationMin: 60, priceCents: null, description: "Deep-cleansing facial customized to your skin." },
      { name: "Botox / injectables", durationMin: 30, priceCents: null, description: "Priced per unit or area at your consultation." },
      { name: "Laser hair removal", durationMin: 45, priceCents: null, description: "Priced by area; packages available." },
    ],
    faq: [],
    hours: week("10:00", "18:00", [0, 1]),
    guardrails:
      BASE_GUARDRAILS +
      " Never give medical advice or promise treatment results. Don't quote injectable pricing beyond " +
      "'priced at your consultation.' New clients wanting injectables or laser must book the " +
      "consultation first.",
    booking:
      "New clients asking about injectables or laser book the consultation. Confirm the treatment, " +
      "date and time, and the caller's name and phone number, then read it back.",
  },
  {
    industry: "Home services",
    services: [
      { name: "Service call & diagnostic", durationMin: 60, priceCents: null, description: "A technician diagnoses the problem and quotes the repair before any work." },
      { name: "Estimate", durationMin: 30, priceCents: null, description: "In-home estimate for installs and larger projects." },
      { name: "Seasonal tune-up", durationMin: 90, priceCents: null, description: "Preventive check and tune-up to keep your system running right." },
    ],
    faq: [],
    hours: week("07:00", "17:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " Never invent or quote job prices — if a caller asks what a job costs, say the team will confirm " +
      "pricing. If a caller mentions a " +
      "gas smell, tell them to leave the building immediately and call 911 or the gas company before " +
      "anything else — then take their details. Burst pipes or no heat in freezing weather are " +
      "emergencies: flag them and collect the address and callback number.",
    booking:
      "Always collect the service address along with the caller's name and phone number. Confirm what's " +
      "wrong in their words, the visit type, and the date and time, then read the booking back.",
  },
  {
    industry: "Auto repair",
    services: [
      { name: "Oil change", durationMin: 30, priceCents: null, description: "Full-service oil change with a multi-point inspection." },
      { name: "Diagnostic", durationMin: 60, priceCents: null, description: "We pinpoint the problem and call you with a quote before any work." },
      { name: "Brake inspection", durationMin: 45, priceCents: null, description: "Brake check with a written estimate if anything needs attention." },
    ],
    faq: [],
    hours: [
      ...week("08:00", "18:00", [0]).slice(0, 6),
      { dayOfWeek: 6, isClosed: false, openTime: "09:00", closeTime: "14:00" },
    ],
    guardrails:
      BASE_GUARDRAILS +
      " Never diagnose a car problem or quote repair prices over the phone — only the listed service " +
      "prices. Get the vehicle's year, make, and model with every booking.",
    booking:
      "Collect the vehicle's year, make, and model plus the caller's name and phone number. Confirm the " +
      "service and the drop-off date and time, then read the booking back.",
  },
  {
    industry: "HVAC",
    services: [
      { name: "Service call & diagnostic", durationMin: 60, priceCents: null, description: "A technician diagnoses your heating or cooling problem and quotes the repair before any work." },
      { name: "AC tune-up", durationMin: 90, priceCents: null, description: "Pre-season inspection, coil clean, and refrigerant check." },
      { name: "Furnace tune-up", durationMin: 90, priceCents: null, description: "Pre-winter safety and efficiency check, including heat exchanger inspection." },
      { name: "Replacement estimate", durationMin: 45, priceCents: null, description: "In-home estimate for a new system." },
    ],
    faq: [],
    hours: week("07:00", "18:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " If a caller smells gas: tell them to leave the building NOW, then call 911 or their gas company " +
      "from outside — before giving you any details. Do not book anything on that call; a leak is not an " +
      "appointment. No heat in freezing weather, no cooling in extreme heat, or a home with an infant or " +
      "elderly resident is an emergency: flag it, collect address and callback number, and say the team " +
      "will be told immediately. Never invent or quote repair or install prices — say the team will confirm pricing.",
    booking:
      "Always collect the service address, what the system is doing in the caller's words, and roughly " +
      "how old the equipment is. Read the booking back, including the address.",
  },
  {
    industry: "Veterinary",
    services: [
      { name: "Wellness exam", durationMin: 30, priceCents: null, description: "Routine check-up, including weight, teeth, and vaccination review." },
      { name: "Sick visit", durationMin: 30, priceCents: null, description: "For a pet that's off its food, limping, scratching, or just not right." },
      { name: "Vaccination visit", durationMin: 15, priceCents: null, description: "Boosters and required shots — price depends on what's due." },
      { name: "Dental cleaning", durationMin: 120, priceCents: null, description: "Under anesthesia, with a pre-exam required first. We'll quote after the exam." },
    ],
    faq: [],
    hours: [
      ...week("08:00", "18:00", [0]).slice(0, 6),
      { dayOfWeek: 6, isClosed: false, openTime: "09:00", closeTime: "13:00" },
    ],
    guardrails:
      BASE_GUARDRAILS +
      " Never give medical advice about an animal — no doses, no \"wait and see\", no diagnosis. If a pet " +
      "is having trouble breathing, seizing, bleeding heavily, unable to stand, or was hit by a car, tell " +
      "the caller to go to the nearest emergency animal hospital immediately rather than book anything. " +
      "For suspected poisoning, give the ASPCA Poison Control number, (888) 426-4435, before taking a message.",
    booking:
      "Collect the pet's name, species and breed, what's going on in the owner's words, and the owner's " +
      "name and phone number. Read the booking back.",
  },
  {
    industry: "Chiropractic",
    services: [
      { name: "New patient exam & adjustment", durationMin: 45, priceCents: null, description: "Consultation, exam, and your first adjustment if appropriate." },
      { name: "Adjustment", durationMin: 15, priceCents: null, description: "Standard adjustment for established patients." },
      { name: "Adjustment + soft tissue work", durationMin: 30, priceCents: null, description: "Adjustment with targeted muscle work for stubborn areas." },
    ],
    faq: [],
    hours: week("09:00", "18:00", [0, 6]),
    guardrails:
      BASE_GUARDRAILS +
      " Never give medical advice or promise treatment outcomes. If a caller describes numbness in the " +
      "groin or inner thighs, loss of bladder or bowel control, or sudden severe weakness in the legs, " +
      "treat it as an emergency: tell them to seek immediate medical care rather than book an adjustment.",
    booking:
      "Ask whether they're a new or returning patient — new patients get the longer first visit. Collect " +
      "name, phone number, and what's bothering them, then read the booking back.",
  },
  {
    industry: "Fitness",
    services: [
      { name: "Intro session & tour", durationMin: 45, priceCents: null, description: "First visit: see the space, talk goals, try a workout." },
      { name: "Personal training session", durationMin: 60, priceCents: null, description: "One-on-one session tailored to your goals." },
      { name: "Small group class", durationMin: 60, priceCents: null, description: "Coached group session." },
    ],
    faq: [],
    hours: [
      ...week("06:00", "21:00", []).slice(0, 6),
      { dayOfWeek: 6, isClosed: false, openTime: "08:00", closeTime: "16:00" },
    ],
    guardrails:
      BASE_GUARDRAILS +
      " Never give training, nutrition, or injury advice on the phone — book them with a coach instead. " +
      "Don't invent or quote membership prices; pricing conversations happen at the " +
      "intro visit where someone can match a plan to the person.",
    booking:
      "Steer new callers to the intro session first. Collect name, phone number, and what they're " +
      "hoping to work on, then read the booking back.",
  },
  {
    industry: "Plumbing",
    services: [
      { name: "Service call & diagnostic", durationMin: 60, priceCents: null, description: "A plumber finds the problem and quotes the fix before any work." },
      { name: "Drain clearing", durationMin: 60, priceCents: null, description: "Clogged sink, tub, toilet, or main line cleared. Price depends on the line and access." },
      { name: "Water heater repair or replacement", durationMin: 120, priceCents: null, description: "Tank and tankless repairs and installs, quoted on site." },
      { name: "Estimate", durationMin: 30, priceCents: null, description: "In-home estimate for repipes, remodels, and larger jobs." },
    ],
    faq: [],
    hours: week("07:00", "18:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " Never invent or quote repair prices — if a caller asks what a job costs, say the team will confirm " +
      "pricing. An active leak, burst pipe, or sewage backup is " +
      "an emergency: tell the caller to shut off the main water valve if they can do it safely, then " +
      "collect the address and callback number and flag it. If they smell gas, tell them to leave the " +
      "building and call 911 or the gas company first.",
    booking:
      "Always collect the service address, what's happening in the caller's words, and where in the home " +
      "it is. Confirm the date and time window, then read the booking back, including the address.",
  },
  {
    industry: "Electrician",
    services: [
      { name: "Service call & diagnostic", durationMin: 60, priceCents: null, description: "An electrician troubleshoots the problem and quotes the fix before any work." },
      { name: "Outlet, switch, or fixture install", durationMin: 60, priceCents: null, description: "New or replacement outlets, switches, lights, and ceiling fans, quoted per job." },
      { name: "Panel upgrade estimate", durationMin: 45, priceCents: null, description: "On-site estimate for panel upgrades, EV chargers, and rewiring." },
    ],
    faq: [],
    hours: week("07:30", "17:30", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " Never give DIY electrical advice beyond safety steps. Sparking, smoke, a burning smell, or a hot " +
      "panel is an emergency: tell the caller to stay away from it and switch off the main breaker only if " +
      "it's safe, call 911 if there's smoke or fire, then collect the address and callback number and flag it.",
    booking:
      "Always collect the service address, what's happening in the caller's words, and whether the home is " +
      "owned or rented. Confirm the date and time window, then read the booking back.",
  },
  {
    industry: "Locksmith",
    services: [
      { name: "Lockout service", durationMin: 30, priceCents: null, description: "Home, car, or business lockout. Price depends on the lock, time of day, and location." },
      { name: "Rekey or lock change", durationMin: 60, priceCents: null, description: "Rekey existing locks or install new ones, quoted per lock." },
      { name: "Smart lock install", durationMin: 60, priceCents: null, description: "Install and set up a keypad or smart lock." },
    ],
    faq: [],
    hours: week("08:00", "20:00", []),
    guardrails:
      BASE_GUARDRAILS +
      " Never quote a firm price — the locksmith confirms it on site before starting. Always tell the caller " +
      "they'll need ID showing they live at or own the property or vehicle. A child or pet locked in a car, " +
      "or anyone in danger, is an emergency: tell them to call 911 first.",
    booking:
      "Collect the exact location, whether it's a home, car (year, make, model), or business, and the " +
      "caller's name and phone number. Read the booking back, including the address.",
  },
  {
    industry: "House cleaning",
    services: [
      { name: "Standard cleaning", durationMin: 120, priceCents: null, description: "Kitchen, bathrooms, dusting, floors. Price depends on home size." },
      { name: "Deep cleaning", durationMin: 240, priceCents: null, description: "A top-to-bottom clean including baseboards, inside appliances, and detail work." },
      { name: "Move-in / move-out cleaning", durationMin: 240, priceCents: null, description: "Empty-home clean for moving day or a deposit walkthrough." },
    ],
    faq: [],
    hours: week("08:00", "18:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " Never quote a firm price — quotes depend on home size and condition, so take the details and have " +
      "the team follow up. Never ask the caller to read out a door code or alarm code on the call; the team " +
      "will collect access details securely.",
    booking:
      "Collect the address, number of bedrooms and bathrooms, the type of clean, and any pets. Confirm the " +
      "date and arrival window, then read the booking back.",
  },
  {
    industry: "Pest control",
    services: [
      { name: "Inspection", durationMin: 45, priceCents: null, description: "A technician identifies the pest and recommends a treatment plan." },
      { name: "One-time treatment", durationMin: 60, priceCents: null, description: "Targeted treatment for ants, roaches, rodents, and more, quoted after inspection." },
      { name: "Recurring service plan", durationMin: 60, priceCents: null, description: "Quarterly or monthly service to keep pests out." },
    ],
    faq: [],
    hours: week("08:00", "17:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " Never recommend a pesticide or DIY treatment, and never invent or quote treatment prices — the " +
      "technician quotes after inspection. Bees or wasps near someone allergic, or a bite with a bad " +
      "reaction, is a medical matter: tell them to call 911.",
    booking:
      "Collect the address, what pest they're seeing and where, and whether there are kids or pets in the " +
      "home. Confirm the date and time window, then read the booking back.",
  },
  {
    industry: "Other",
    services: [
      { name: "Consultation", durationMin: 30, priceCents: null, description: "A conversation about what you need and how we can help." },
      { name: "Standard appointment", durationMin: 60, priceCents: null, description: "Our regular service visit." },
      { name: "Follow-up visit", durationMin: 30, priceCents: null, description: "A shorter return visit for existing customers." },
    ],
    faq: [],
    hours: week("09:00", "17:00", [0, 6]),
    guardrails:
      BASE_GUARDRAILS +
      " These services and hours are placeholders the owner hasn't finished editing — if a caller asks " +
      "about something not listed, take a message rather than improvise.",
    booking:
      "Collect the caller's name, phone number, and what they need, then read the booking back.",
  },
];

/** Validate a form-supplied industry against the known list; anything else → null. */
export function safeIndustry(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return (INDUSTRIES as readonly string[]).includes(v) ? v : null;
}

/** The pack for a chosen industry; unmatched or empty → the generic default. */
export function packForIndustry(industry: string | null | undefined): StarterPack {
  const wanted = (industry ?? "").trim().toLowerCase();
  if (!wanted) return DEFAULT_PACK;
  return STARTER_PACKS.find((p) => p.industry?.toLowerCase() === wanted) ?? DEFAULT_PACK;
}
