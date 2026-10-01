import type Anthropic from "@anthropic-ai/sdk";

/**
 * The AI text assistant's tools.
 *
 * Three of them are the SAME agent-tool endpoints the phone agent (and the web
 * chat) call — `path` is the route under /api/agent-tools — so a booking made
 * by text gets the same hours/blocks/clash checks, the same calendar write and
 * the same owner alert as one made on a call. Nothing here re-implements
 * booking. The endpoints see channel "sms" (from our signed header, never from
 * the body) and treat the texting number like caller ID: bookings go under it
 * and only its own appointments can be cancelled.
 *
 * The last two are local "final answer" tools: the model must end each turn by
 * choosing to reply or to hand the conversation to the owner.
 */
export interface SmsTool {
  /** Agent-tool route, or null for the local final-answer tools. */
  path: "check-availability" | "book" | "cancel" | null;
  def: Anthropic.Tool;
}

export const SEND_REPLY = "send_reply";
export const HANDOFF = "handoff_to_owner";

export function smsTools(opts: { bookingEnabled: boolean }): SmsTool[] {
  const tools: SmsTool[] = [];
  if (opts.bookingEnabled) {
    tools.push(
      {
        path: "check-availability",
        def: {
          name: "check_availability",
          description: "Open appointment slots for a service over the next 7 days. Call before offering or booking any time.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              service: { type: "string", description: "The service the customer wants." },
              date_range: { type: "string", description: "Optional, e.g. 'next Tuesday'." },
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
            "Book an appointment after the customer clearly said yes to the service and time. It is booked under the number that is texting.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              service: { type: "string" },
              datetime: { type: "string", description: "ISO 8601 start date-time from check_availability." },
              name: { type: "string", description: "Customer's name if they gave it, else empty." },
              person: { type: "string", description: "Optional staff member they asked for." },
            },
            required: ["service", "datetime"],
          },
        },
      },
      {
        path: "cancel",
        def: {
          name: "cancel_appointment",
          description:
            "Cancel the texting customer's own upcoming appointment (only appointments booked under the number that is texting). Confirm which one and get a clear yes first.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              datetime: {
                type: "string",
                description: "ISO 8601 start of the appointment to cancel — needed if they have more than one.",
              },
            },
          },
        },
      },
    );
  }
  tools.push(
    {
      path: null,
      def: {
        name: SEND_REPLY,
        description: "Send your reply text to the customer. Plain text, under 300 characters, no links or phone numbers.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    },
    {
      path: null,
      def: {
        name: HANDOFF,
        description:
          "Stop replying and hand this conversation to a person at the business. Use when unsure, when they ask for a person, or when the topic is sensitive or urgent.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: { type: "string", enum: ["human_requested", "emergency", "sensitive", "unsure"] },
            note: { type: "string", description: "One short line for the owner about what the customer needs." },
          },
          required: ["category"],
        },
      },
    },
  );
  return tools;
}
