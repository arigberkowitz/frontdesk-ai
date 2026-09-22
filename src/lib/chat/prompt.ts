/**
 * The phone receptionist's prompt, adjusted for a screen.
 *
 * The prompt this business already has was written for a voice call — read
 * the number back, one question at a time, keep it under a minute. Most of
 * that is still right in chat; some of it is wrong in ways a visitor would
 * notice. This wraps the existing prompt rather than forking it, so every
 * improvement the nightly agent makes to the phone receptionist reaches the
 * chat one for free, and the two never drift into different personalities.
 *
 * Pure function so the wording can be tested without a database.
 */
export function chatChannelPreamble(input: { businessName: string; agentName: string }): string {
  return [
    `CHANNEL: You are ${input.agentName}, answering for ${input.businessName} in a text chat on the business's website. Not a phone call.`,
    "",
    "What that changes:",
    "- Keep every reply short. Two or three sentences, then stop and wait. A wall of text in a chat bubble reads as a form letter.",
    "- You cannot transfer anyone to a person or put anyone on hold. If someone needs a human, take a message with their name and number and say the team will call them back.",
    "- Don't read numbers back or spell things out — they can see what they typed. Do confirm the important details (service, day, time, name, number) once, in one line, before you book.",
    "- When you need a phone number, ask for it plainly. When you need consent to text them, ask in these words: \"Want me to text you the confirmation and a reminder? Reply STOP anytime to opt out.\" Only pass sms_consent as true if they clearly say yes.",
    "- Dates: today's date and the business timezone are below. Resolve \"tomorrow\" and \"next Tuesday\" against them. Always pass ISO 8601 date-times to tools.",
    "- If a tool tells you what to say, say that. It knows the calendar; you don't.",
    "- Never invent an opening, a price, or a policy that isn't in your instructions or a tool result.",
    "",
    "Everything below is your standing instruction set for this business. Follow it, minus the parts that only make sense out loud.",
    "",
  ].join("\n");
}

/** "Wednesday, September 22, 2026, 3:14 PM" in the business's own zone. */
export function nowLine(timezone: string | null, now = new Date()): string {
  try {
    const stamp = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone ?? "America/Los_Angeles",
      dateStyle: "full",
      timeStyle: "short",
    }).format(now);
    return `CURRENT DATE AND TIME: ${stamp} (${timezone ?? "America/Los_Angeles"}).`;
  } catch {
    return `CURRENT DATE AND TIME: ${now.toISOString()} (UTC).`;
  }
}

/**
 * The first thing a visitor sees. The phone greeting says "thanks for
 * calling", which is exactly wrong in a chat bubble. Short, names who's
 * answering, and says what it can do so nobody has to guess.
 */
export function chatGreeting(input: { businessName: string; agentName: string }): string {
  return `Hi! I'm ${input.agentName}, the AI receptionist for ${input.businessName}. I can answer questions or book you a visit \u2014 what can I help with?`;
}
