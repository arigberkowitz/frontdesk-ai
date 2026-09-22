import type Anthropic from "@anthropic-ai/sdk";

/**
 * The receptionist's tools, described for Anthropic instead of for Retell.
 *
 * These are the SAME endpoints the phone agent calls — `path` is the route
 * under /api/agent-tools — with the same argument names, so a booking made in
 * chat goes through the same clash checks, the same calendar write, the same
 * confirmation text and the same webhook as one made on a call. Nothing here
 * is a second implementation of anything.
 *
 * Transfer is absent on purpose: a chat cannot be handed to a phone. Its job
 * is covered by the preamble's "take a message" instruction.
 */
export interface ChatTool {
  path: string;
  def: Anthropic.Tool;
}

export function chatTools(opts: { waitlistEnabled: boolean }): ChatTool[] {
  const tools: ChatTool[] = [
    {
      path: "check-availability",
      def: {
        name: "check_availability",
        description:
          "Check open appointment slots for a service over a date range. Call this before booking.",
        input_schema: {
          type: "object",
          properties: {
            service: { type: "string", description: "The service the visitor wants to book." },
            date_range: {
              type: "string",
              description: "Natural-language date or range, e.g. 'next Tuesday' or 'this week'.",
            },
          },
          required: ["service"],
        },
      },
    },
    {
      path: "book",
      def: {
        name: "book_appointment",
        description:
          "Book an appointment after confirming service, date/time, name, and phone in one line and getting a yes.",
        input_schema: {
          type: "object",
          properties: {
            service: { type: "string" },
            datetime: { type: "string", description: "ISO 8601 start date-time." },
            name: { type: "string" },
            phone: { type: "string" },
            person: {
              type: "string",
              description:
                "Optional: the staff member they asked for by name. Omit if no preference.",
            },
            sms_consent: {
              type: "boolean",
              description:
                "True ONLY if the visitor clearly agreed to be texted the confirmation and a reminder after you asked in those words. Giving a phone number is not agreement.",
            },
          },
          required: ["service", "datetime", "name", "phone", "sms_consent"],
        },
      },
    },
    {
      path: "cancel",
      def: {
        name: "cancel_appointment",
        description:
          "Cancel the visitor's existing appointment. Confirm which one and get a clear yes first. Looks the booking up by phone number.",
        input_schema: {
          type: "object",
          properties: {
            phone: { type: "string", description: "The phone number the appointment was booked under." },
            datetime: {
              type: "string",
              description:
                "ISO 8601 start of the appointment to cancel — only needed if they have more than one upcoming.",
            },
          },
          required: ["phone"],
        },
      },
    },
    {
      path: "message",
      def: {
        name: "take_message",
        description:
          "Capture a message/lead when booking isn't possible or the visitor needs a person. Get name and phone; also capture what they need (service), how soon (urgency), and any budget they mention.",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            reason: { type: "string" },
            message: { type: "string" },
            service: { type: "string" },
            urgency: { type: "string" },
            budget: { type: "string" },
          },
          required: ["name", "phone"],
        },
      },
    },
  ];

  if (opts.waitlistEnabled) {
    tools.push({
      path: "waitlist",
      def: {
        name: "join_waitlist",
        description:
          "Offer this ONLY after check_availability could not give them a time that works. Ask if they'd like a text when something opens up, and call this if they say yes. Capture the RANGE of times they'd accept.",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            service: { type: "string" },
            earliest_datetime: { type: "string", description: "ISO 8601. Omit if anything from now works." },
            latest_datetime: { type: "string", description: "ISO 8601. Omit if flexible." },
            note: { type: "string", description: "What they said about timing, in their words." },
          },
          required: ["name", "phone"],
        },
      },
    });
  }

  return tools;
}
