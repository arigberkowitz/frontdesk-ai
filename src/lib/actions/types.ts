import type { z } from "zod";

/** Shared result shape for Server Actions driven by React 19 `useActionState`. */
export type ActionState = {
  ok?: boolean;
  error?: string;
  /** Optional success message for a toast (e.g. "Text reminder sent"). */
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Optional payload (e.g. created id, slot list) for the caller to use. */
  data?: unknown;
};

export const initialActionState: ActionState = {};

/** Map a ZodError to `{ field: messages[] }` (stable across zod v3/v4). */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
