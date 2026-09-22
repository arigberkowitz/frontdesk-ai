import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignInPage } from "@/components/ui/sign-in-flow-1";

export const metadata: Metadata = { title: "Sign up" };

/**
 * The same passwordless flow as sign-in, opened on the "Get started" framing.
 *
 * This used to render Clerk's stock <SignUp/> — email AND a password — one
 * click after a sign-in page that promises "no password needed". Two stories
 * on back-to-back screens, and the password one was the lie: the account it
 * created was then signed into with an emailed code anyway.
 *
 * A signed-in visitor goes straight to their home, same as /sign-in.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { userId } = await auth();
  if (userId) redirect("/");
  // Which pricing card they clicked, carried through to setup so the plan
  // they picked on the website is the one preselected at checkout.
  const { plan } = await searchParams;
  const next = plan ? `/welcome?plan=${encodeURIComponent(plan)}` : "/";
  return <SignInPage initialView="signup" afterUrl={next} />;
}
