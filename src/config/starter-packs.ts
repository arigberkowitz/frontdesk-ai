import { INDUSTRIES } from "@/config/options";

/**
 * Industry starter packs: real, editable content a brand-new business starts
 * with — services with honest durations/prices, FAQ drafts in the business's
 * own voice, typical hours, and guardrails tuned to the industry's risks
 * (a dental office fields toothache emergencies; a plumber fields gas leaks).
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
    industry: "Dental",
    services: [
      { name: "New patient exam & X-rays", durationMin: 60, priceCents: 9900, description: "Comprehensive first visit: full exam, X-rays, and a treatment plan." },
      { name: "Cleaning & checkup", durationMin: 60, priceCents: 12500, description: "Routine hygiene cleaning with a doctor's checkup." },
      { name: "Teeth whitening", durationMin: 90, priceCents: 34900, description: "In-office professional whitening session." },
      { name: "Emergency visit", durationMin: 30, priceCents: null, description: "Same-day slot for tooth pain, a broken tooth, or swelling. Cost depends on treatment." },
    ],
    faq: [
      { question: "Do you take my insurance?", answer: "We accept most major PPO plans. Bring your insurance card to your visit and we'll verify your coverage and benefits for you." },
      { question: "Are you accepting new patients?", answer: "Yes! New patients are always welcome — our new patient exam includes X-rays and a full treatment plan." },
      { question: "I have a toothache — can you see me today?", answer: "We keep same-day slots for dental emergencies. Call as early as you can and we'll fit you in as soon as possible." },
      { question: "Do you offer payment plans?", answer: "Yes, we offer financing options and payment plans for larger treatments — we'll go over them at your visit." },
      { question: "How do I reschedule or cancel?", answer: "Give us at least 24 hours' notice and we'll happily move your visit — it also frees the slot for someone in pain." },
    ],
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
    industry: "Med spa",
    services: [
      { name: "Consultation", durationMin: 30, priceCents: 0, description: "A free consultation to build your treatment plan — required before injectables." },
      { name: "Signature facial", durationMin: 60, priceCents: 15000, description: "Deep-cleansing facial customized to your skin." },
      { name: "Botox / injectables", durationMin: 30, priceCents: null, description: "Priced per unit or area at your consultation." },
      { name: "Laser hair removal", durationMin: 45, priceCents: null, description: "Priced by area; packages available." },
    ],
    faq: [
      { question: "Do I need a consultation first?", answer: "For injectables and laser treatments, yes — a free consultation comes first so we can build a plan that's safe and right for you. Facials can be booked directly." },
      { question: "Is there any downtime?", answer: "Most treatments have little to no downtime, but it varies by treatment and person — we'll go over exactly what to expect at your consultation." },
      { question: "Do you offer packages or memberships?", answer: "Yes — most treatments come in discounted series, and members save on every visit. Ask at your consultation." },
      { question: "What's your cancellation policy?", answer: "We ask for 24 hours' notice to reschedule so we can offer the time to another client." },
    ],
    hours: week("10:00", "18:00", [0, 1]),
    guardrails:
      BASE_GUARDRAILS +
      " Never give medical advice or promise treatment results. Don't quote injectable pricing beyond " +
      "'priced at your consultation.' New clients wanting injectables or laser must book the " +
      "consultation first.",
    booking:
      "New clients asking about injectables or laser book the free consultation. Confirm the treatment, " +
      "date and time, and the caller's name and phone number, then read it back.",
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
    industry: "Veterinary",
    services: [
      { name: "Wellness exam", durationMin: 30, priceCents: 6500, description: "Routine check-up, including weight, teeth, and vaccination review." },
      { name: "Sick visit", durationMin: 30, priceCents: 7500, description: "For a pet that's off its food, limping, scratching, or just not right." },
      { name: "Vaccination visit", durationMin: 15, priceCents: null, description: "Boosters and required shots — price depends on what's due." },
      { name: "Dental cleaning", durationMin: 120, priceCents: null, description: "Under anesthesia, with a pre-exam required first. We'll quote after the exam." },
    ],
    faq: [
      { question: "Is this an emergency? My pet ate something.", answer: "If your pet ate chocolate, grapes, xylitol gum, medication, or anything toxic, call the ASPCA Poison Control line at (888) 426-4435 right away — they're the fastest experts. We can see your pet as soon as possible afterward." },
      { question: "Do you see exotic pets?", answer: "Our doctors primarily see dogs and cats — call it a message and the team will confirm whether we can see your specific pet." },
      { question: "How much is an exam?", answer: "A routine wellness exam is $65; treatment costs depend on what the doctor finds, and you'll get an estimate before anything is done." },
      { question: "Can I get my pet's records sent somewhere?", answer: "Of course — leave your name, your pet's name, and where the records should go, and the front desk will send them over." },
    ],
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
      { name: "New patient exam & adjustment", durationMin: 45, priceCents: 9500, description: "Consultation, exam, and your first adjustment if appropriate." },
      { name: "Adjustment", durationMin: 15, priceCents: 5500, description: "Standard adjustment for established patients." },
      { name: "Adjustment + soft tissue work", durationMin: 30, priceCents: 8500, description: "Adjustment with targeted muscle work for stubborn areas." },
    ],
    faq: [
      { question: "Do you take insurance?", answer: "We work with most major plans — bring your card to your first visit and the front desk will verify your coverage before you're seen." },
      { question: "Does an adjustment hurt?", answer: "Most patients find it relieving rather than painful. The doctor always examines first and only adjusts what's appropriate for you." },
      { question: "How many visits will I need?", answer: "That's genuinely case-by-case — the doctor will lay out a plan at your first exam and you'll never be locked into anything." },
      { question: "Can you help with headaches or sciatica?", answer: "Those are two of the most common things we treat. The first exam will tell us whether your case is one we can help with." },
    ],
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
