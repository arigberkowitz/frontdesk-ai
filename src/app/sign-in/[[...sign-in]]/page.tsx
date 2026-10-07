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
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { userId } = await auth();
  if (userId) redirect("/");
  const { reason } = await searchParams;
  return (
    <>
      {/* A setup link that's already done its job lands here (intake page). */}
      {reason === "setup-link-used" ? (
        <div
          role="status"
          className="relative z-50 border-b border-brand/20 bg-brand-soft px-4 py-2.5 text-center text-sm"
        >
          <span className="font-medium">That setup link has already been used.</span>{" "}
          <span className="text-muted-foreground">
            Your business has an account now — sign in to keep setting it up.
          </span>
        </div>
      ) : null}
      <SignInPage />
    </>
  );
}
