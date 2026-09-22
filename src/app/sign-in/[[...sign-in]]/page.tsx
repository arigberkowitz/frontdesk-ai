import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignInPage } from "@/components/ui/sign-in-flow-1";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Someone who is already signed in has no business on this page, and the form
 * agrees: submitting it with a live session makes Clerk throw "session
 * exists", which the page rendered as a red "You're already signed in."
 * beneath a form it had just invited them to fill in. Happens whenever a
 * stale sign-in tab is still open after signing in elsewhere — which is how
 * most people end up here twice.
 *
 * Checked on the server so a signed-in visitor never sees the form at all.
 * "/" is where the app routes a signed-in user to their own home.
 */
export default async function Page() {
  const { userId } = await auth();
  if (userId) redirect("/");
  return <SignInPage />;
}
