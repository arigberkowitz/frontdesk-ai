/**
 * What a locked Pro feature would have done for THIS business, in its own
 * numbers. Pure, so the wording rules are tested: real counts only, and when
 * the count is zero or there isn't enough history, a plain generic line —
 * never an invented number.
 */
import { monthsLabel } from "@/lib/winback";

export interface TeaserCopy {
  /** The headline: a real count, or the generic line. */
  line: string;
  /** The honest follow-on (who Pro could actually text), or null. */
  detail: string | null;
  /** True when `line` is built from this business's data. */
  fromData: boolean;
}

const n = (v: number) => v.toLocaleString("en-US");

/**
 * How many of the people in a teaser Pro could actually have texted. Only
 * people with a stored yes to texts (and no STOP) are ever texted, so the
 * teaser says so instead of promising a text to everyone it counted.
 */
export function reachLine(total: number, textable: number, phrases: { all: string; some: string }): string {
  if (textable >= total) return phrases.all;
  if (textable > 0) return `${n(textable)} of them said yes to texts, so ${phrases.some}.`;
  return "None of them said yes to texts on a call yet, so Pro couldn't text them. Customers who say yes when they book can get these.";
}

export function quoteTeaser(input: { asked: number; textable: number; days: number }): TeaserCopy {
  if (input.asked <= 0) {
    return {
      line: "When someone calls for a price and doesn't book, Pro texts them a day later and again a week later, so the quote doesn't go cold.",
      detail: null,
      fromData: false,
    };
  }
  const who = input.asked === 1 ? "1 caller asked for a price and never booked" : `${n(input.asked)} callers asked for a price and never booked`;
  return {
    line: `In the last ${input.days} days, ${who}.`,
    detail: reachLine(input.asked, input.textable, {
      all: input.asked === 1 ? "Pro would have followed up with them." : "Pro would have followed up with each one.",
      some: "Pro would have followed up with them",
    }),
    fromData: true,
  };
}

export function reviewTeaser(input: { visits: number; textable: number; days: number }): TeaserCopy {
  if (input.visits <= 0) {
    return {
      line: "A couple of hours after each visit, Pro texts the customer your Google review link. One ask per customer every 90 days.",
      detail: null,
      fromData: false,
    };
  }
  const what = input.visits === 1 ? "1 booked visit" : `${n(input.visits)} booked visits`;
  return {
    line: `In the last ${input.days} days, ${what} could have gotten a review request.`,
    detail: reachLine(input.visits, input.textable, {
      all: "Pro would have texted each customer your review link.",
      some: "Pro would have texted them your review link",
    }),
    fromData: true,
  };
}

export function winbackTeaser(input: { due: number; textable: number; months: number }): TeaserCopy {
  if (input.due <= 0) {
    return {
      line: "Once a month, Pro texts past customers who haven't been back in a while (a 6-month cleaning, a yearly tune-up) and invites them to book.",
      detail: null,
      fromData: false,
    };
  }
  const who = input.due === 1 ? "1 past customer hasn't" : `${n(input.due)} past customers haven't`;
  return {
    line: `${who} been back in ${monthsLabel(input.months)} or more.`,
    detail: reachLine(input.due, input.textable, {
      all: "Pro would text each of them once this month and invite them to book.",
      some: "Pro would text them once this month and invite them to book",
    }),
    fromData: true,
  };
}
