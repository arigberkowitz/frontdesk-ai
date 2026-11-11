import { INDUSTRIES } from "@/config/options";

/**
 * Industry starter packs: real, editable content a brand-new business starts
 * with — services with honest durations/prices, FAQ drafts in the business's
 * own voice, typical hours, and guardrails tuned to the industry's risks
 * (a locksmith fields lockouts; a plumber fields gas leaks).
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
    { name: "Consultation", durationMin: 30, priceCents: 0, description: "A free intro call to understand what the customer needs." },
    { name: "Standard appointment", durationMin: 60, priceCents: 12000, description: "Your most common service." },
    { name: "Follow-up visit", durationMin: 30, priceCents: 8000, description: "A shorter check-in for returning customers." },
  ],
  faq: [
    { question: "What are your hours?", answer: "We're open Monday to Friday, 9am to 5pm." },
    { question: "Do I need an appointment, or do you take walk-ins?", answer: "Appointments are best, but we take walk-ins whenever we have availability." },
    { question: "How do I reschedule or cancel?", answer: "Just let us know at least 24 hours ahead and we'll happily move your appointment." },
  ],
  hours: week("09:00", "17:00", [0, 6]),
  guardrails: BASE_GUARDRAILS + " Never give medical, legal, or financial advice.",
  booking:
    "Offer the next available openings during business hours. Before booking, confirm the service, the " +
    "date and time, and the caller's name and phone number, then read the appointment back to them.",
};

export const STARTER_PACKS: StarterPack[] = [
  {
    industry: "Law",
    services: [
      { name: "Free case evaluation", durationMin: 15, priceCents: 0, description: "A short call to understand the matter and whether we can help." },
      { name: "Initial consultation", durationMin: 45, priceCents: 20000, description: "An in-depth meeting with an attorney to review your case and options." },
      { name: "Document review", durationMin: 60, priceCents: null, description: "An attorney reviews your contract or documents. Quoted after the evaluation." },
    ],
    faq: [
      { question: "Do you offer free consultations?", answer: "We offer a free 15-minute case evaluation to see whether we're a fit. In-depth consultations with an attorney are paid." },
      { question: "What should I bring to my consultation?", answer: "Any documents related to your matter — contracts, letters, court papers, photos — plus a timeline of key dates if you can." },
      { question: "How do your fees work?", answer: "It depends on the matter — some cases are flat fee, some hourly, and some contingency. The attorney will explain exactly what applies to yours at the consultation." },
      { question: "Is what I tell you confidential?", answer: "Yes — what you share with our office is treated confidentially." },
    ],
    hours: week("09:00", "17:00", [0, 6]),
    guardrails:
      BASE_GUARDRAILS +
      " Never give legal advice, predict the outcome of a case, or quote fees for specific legal work — " +
      "only an attorney can do that. Don't say whether the firm will take a case. Collect the caller's " +
      "situation in their own words and book the evaluation or take a detailed message.",
    booking:
      "For new matters, book the free case evaluation first. Confirm the date and time, the caller's " +
      "name and phone number, and a one-line description of the matter, then read the consultation back " +
      "to them.",
  },
  {
    industry: "Salon & beauty",
    services: [
      { name: "Haircut", durationMin: 30, priceCents: 4000, description: "Cut, style, and finish." },
      { name: "Haircut & beard trim", durationMin: 45, priceCents: 5500, description: "Full cut plus beard shaping and line-up." },
      { name: "Color", durationMin: 120, priceCents: 12000, description: "Single-process color. Longer or corrective work is quoted in person." },
      { name: "Kids' cut", durationMin: 30, priceCents: 2500, description: "Cut for kids 12 and under." },
    ],
    faq: [
      { question: "Do you take walk-ins?", answer: "Walk-ins are welcome whenever there's an open chair — but booking ahead guarantees your spot and your favorite stylist." },
      { question: "Can I request a specific person?", answer: "Absolutely — just tell us who you'd like when you book and we'll schedule you with them." },
      { question: "What if I'm running late?", answer: "Give us a call! We can usually hold your spot for 10–15 minutes; after that we may need to rebook you." },
      { question: "How do I cancel or reschedule?", answer: "Let us know at least a few hours ahead and we'll move you, no problem." },
    ],
    hours: week("09:00", "19:00", [0, 1]),
    guardrails:
      BASE_GUARDRAILS +
      " Color and corrective work varies a lot — quote the listed starting price and note the stylist " +
      "will confirm in person.",
    booking:
      "Ask if they'd like a specific stylist or barber, then book with that person. Confirm the service, " +
      "who it's with, the date and time, and the caller's name and phone number, then read it back.",
  },
  {
    industry: "Home services",
    services: [
      { name: "Service call & diagnostic", durationMin: 60, priceCents: 8900, description: "A technician diagnoses the problem. The fee is applied toward the repair if you go ahead." },
      { name: "Free estimate", durationMin: 30, priceCents: 0, description: "In-home estimate for installs and larger projects." },
      { name: "Seasonal tune-up", durationMin: 90, priceCents: 12900, description: "Preventive check and tune-up to keep your system running right." },
    ],
    faq: [
      { question: "Can you give me a price over the phone?", answer: "We can't quote a repair sight-unseen — every job is different. The diagnostic fee covers the visit, and it's applied toward the repair if you go ahead." },
      { question: "Do you handle emergencies after hours?", answer: "Yes — we answer emergencies 24/7. After-hours rates may apply; describe the problem and we'll get someone out." },
      { question: "Are you licensed and insured?", answer: "Yes, fully licensed and insured, and our work is guaranteed." },
      { question: "What areas do you serve?", answer: "We serve the local metro area — give us your address and we'll confirm you're in our service area." },
    ],
    hours: week("07:00", "17:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " Never quote repair prices beyond the listed diagnostic and tune-up fees. If a caller mentions a " +
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
      { name: "Oil change", durationMin: 30, priceCents: 6500, description: "Full-service oil change with a multi-point inspection." },
      { name: "Diagnostic", durationMin: 60, priceCents: 12000, description: "We pinpoint the problem and call you with a quote before any work." },
      { name: "Brake inspection", durationMin: 45, priceCents: 0, description: "Free brake check with a written estimate if anything needs attention." },
    ],
    faq: [
      { question: "How long will my car be in the shop?", answer: "Oil changes are usually under an hour. For repairs, we diagnose first and call you with a quote and timeline before doing any work." },
      { question: "Do you offer a shuttle or loaner?", answer: "We offer local drop-off while your car is with us — ask when you book." },
      { question: "Is your work guaranteed?", answer: "Yes — our repairs are backed by a parts and labor warranty. Ask for the details on your specific repair." },
      { question: "Do I need an appointment for an oil change?", answer: "Appointments get you in and out fastest, but we take drive-ins as the schedule allows." },
    ],
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
      { name: "Service call & diagnostic", durationMin: 60, priceCents: 9900, description: "A technician diagnoses your heating or cooling problem. Fee applied toward the repair if you go ahead." },
      { name: "AC tune-up", durationMin: 90, priceCents: 12900, description: "Pre-season inspection, coil clean, and refrigerant check." },
      { name: "Furnace tune-up", durationMin: 90, priceCents: 12900, description: "Pre-winter safety and efficiency check, including heat exchanger inspection." },
      { name: "Replacement estimate", durationMin: 45, priceCents: 0, description: "Free in-home estimate for a new system, with financing options." },
    ],
    faq: [
      { question: "My AC stopped working — how fast can someone come out?", answer: "We keep same-day slots for no-cool and no-heat calls whenever we can. Tell me what's happening and I'll get you the first available visit." },
      { question: "How much does a new system cost?", answer: "It depends on the size of your home and the equipment — that's why the estimate is free and in person. Ballparks over the phone tend to be wrong in both directions." },
      { question: "Do you service all brands?", answer: "Yes — our technicians work on all major makes and models." },
      { question: "Is there a fee for the visit?", answer: "The diagnostic fee covers the technician's visit and applies toward the repair if you go ahead with it." },
    ],
    hours: week("07:00", "18:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " If a caller smells gas: tell them to leave the building NOW, then call 911 or their gas company " +
      "from outside — before giving you any details. Do not book anything on that call; a leak is not an " +
      "appointment. No heat in freezing weather, no cooling in extreme heat, or a home with an infant or " +
      "elderly resident is an emergency: flag it, collect address and callback number, and say the team " +
      "will be told immediately. Never quote repair or install prices beyond the listed fees.",
    booking:
      "Always collect the service address, what the system is doing in the caller's words, and roughly " +
      "how old the equipment is. Read the booking back, including the address.",
  },
  {
    industry: "Fitness",
    services: [
      { name: "Intro session & tour", durationMin: 45, priceCents: 0, description: "Free first visit: see the space, talk goals, try a workout." },
      { name: "Personal training session", durationMin: 60, priceCents: 8500, description: "One-on-one session tailored to your goals." },
      { name: "Small group class", durationMin: 60, priceCents: 2500, description: "Coached group session — all levels welcome, drop-ins allowed." },
    ],
    faq: [
      { question: "How much is a membership?", answer: "Plans vary by how often you want to come and whether you want coaching — the free intro visit is the easiest way to get exact numbers for what you actually need." },
      { question: "I'm a complete beginner. Is that okay?", answer: "That's who the intro session is for — every program scales down as well as up, and nobody's thrown into anything." },
      { question: "Can I freeze or cancel my membership?", answer: "Yes — leave your name and number and the front desk will walk you through the options for your plan." },
      { question: "Do you have showers and lockers?", answer: "Yes, both — bring a lock, or grab one at the front desk." },
    ],
    hours: [
      ...week("06:00", "21:00", []).slice(0, 6),
      { dayOfWeek: 6, isClosed: false, openTime: "08:00", closeTime: "16:00" },
    ],
    guardrails:
      BASE_GUARDRAILS +
      " Never give training, nutrition, or injury advice on the phone — book them with a coach instead. " +
      "Don't quote membership prices beyond the listed sessions; pricing conversations happen at the " +
      "intro visit where someone can match a plan to the person.",
    booking:
      "Steer new callers to the free intro session first. Collect name, phone number, and what they're " +
      "hoping to work on, then read the booking back.",
  },
  {
    industry: "Plumbing",
    services: [
      { name: "Service call & diagnostic", durationMin: 60, priceCents: 9900, description: "A plumber finds the problem and quotes the fix before any work. Fee applied toward the repair if you go ahead." },
      { name: "Drain clearing", durationMin: 60, priceCents: null, description: "Clogged sink, tub, toilet, or main line cleared. Price depends on the line and access." },
      { name: "Water heater repair or replacement", durationMin: 120, priceCents: null, description: "Tank and tankless repairs and installs, quoted on site." },
      { name: "Free estimate", durationMin: 30, priceCents: 0, description: "In-home estimate for repipes, remodels, and larger jobs." },
    ],
    faq: [
      { question: "Can you give me a price over the phone?", answer: "We can't quote a repair sight-unseen — the diagnostic fee covers the visit and applies toward the repair if you go ahead." },
      { question: "Do you handle emergencies?", answer: "Yes — burst pipes, active leaks, and sewer backups get our first available plumber. After-hours rates may apply." },
      { question: "Are you licensed and insured?", answer: "Yes, fully licensed and insured, and our work is guaranteed." },
      { question: "What areas do you serve?", answer: "We serve the local area — give us your address and we'll confirm you're in our service area." },
    ],
    hours: week("07:00", "18:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " Never quote repair prices beyond the listed fees. An active leak, burst pipe, or sewage backup is " +
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
      { name: "Service call & diagnostic", durationMin: 60, priceCents: 9900, description: "An electrician troubleshoots the problem and quotes the fix before any work." },
      { name: "Outlet, switch, or fixture install", durationMin: 60, priceCents: null, description: "New or replacement outlets, switches, lights, and ceiling fans, quoted per job." },
      { name: "Panel upgrade estimate", durationMin: 45, priceCents: 0, description: "Free on-site estimate for panel upgrades, EV chargers, and rewiring." },
    ],
    faq: [
      { question: "Can you give me a price over the phone?", answer: "Electrical work depends on what's behind the wall, so we quote on site. The diagnostic fee covers the visit." },
      { question: "Do you install EV chargers?", answer: "Yes — we install home EV chargers, including any panel work and permits they need." },
      { question: "Are you licensed and insured?", answer: "Yes, we're licensed electricians, fully insured, and we pull permits where required." },
      { question: "Do you handle emergencies?", answer: "Yes — sparking, burning smells, and total power loss get our first available electrician." },
    ],
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
    faq: [
      { question: "How fast can you get here?", answer: "For lockouts we send the first available locksmith — tell me your location and I'll get you an arrival estimate." },
      { question: "How much is a lockout?", answer: "It depends on the lock and the time of day — the locksmith confirms the price before starting any work." },
      { question: "Do I need to show ID?", answer: "Yes — for your security we confirm ID and that you live at or own the property or vehicle before opening it." },
      { question: "Can you make car keys?", answer: "We can help with many vehicles — tell me the year, make, and model and we'll confirm." },
    ],
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
    faq: [
      { question: "How much does a cleaning cost?", answer: "It depends on the size of your home and the type of clean. Tell me the bedrooms and bathrooms and we'll follow up with a quote." },
      { question: "Do I need to be home?", answer: "No — many clients leave a key or door code. We'll confirm access details before the visit." },
      { question: "Do you bring supplies?", answer: "Yes, we bring our own supplies and equipment. Let us know if you'd like us to use yours." },
      { question: "Do you offer recurring cleanings?", answer: "Yes — weekly, every two weeks, or monthly." },
    ],
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
      { name: "Inspection", durationMin: 45, priceCents: 0, description: "A technician identifies the pest and recommends a treatment plan." },
      { name: "One-time treatment", durationMin: 60, priceCents: null, description: "Targeted treatment for ants, roaches, rodents, and more, quoted after inspection." },
      { name: "Recurring service plan", durationMin: 60, priceCents: null, description: "Quarterly or monthly service to keep pests out." },
    ],
    faq: [
      { question: "Are your treatments safe for kids and pets?", answer: "We use products labeled for home use and the technician will tell you how long to keep kids and pets away from treated areas." },
      { question: "How much does treatment cost?", answer: "It depends on the pest and the size of the property — the inspection is free and you get a quote before any treatment." },
      { question: "Do you handle rodents?", answer: "Yes — rats and mice, including sealing the entry points." },
      { question: "What about bed bugs or termites?", answer: "Yes — those start with an inspection so we can quote the right treatment." },
    ],
    hours: week("08:00", "17:00", [0]),
    guardrails:
      BASE_GUARDRAILS +
      " Never recommend a pesticide or DIY treatment, and never quote treatment prices — the inspection is " +
      "free and the technician quotes after. Bees or wasps near someone allergic, or a bite with a bad " +
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
    faq: [
      { question: "How much do you charge?", answer: "It depends on the job — leave your name and number with a quick description and we'll come back to you with a real number instead of a guess." },
      { question: "What areas do you serve?", answer: "Tell me where you are and I'll take a message so the team can confirm we cover you." },
      { question: "When are you open?", answer: "Our regular hours are listed here — and if you can't make them, leave a message and we'll try to work something out." },
    ],
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
