import type { Metadata } from "next";
import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  // Which pricing card they clicked. Carried through Clerk so the plan they
  // picked on the website is the one selected when they reach checkout —
  // otherwise choosing Pro on the pricing page bought them nothing at all, and
  // they had to choose again later having forgotten they already had.
  const { plan } = await searchParams;
  const next = plan ? `/welcome?plan=${encodeURIComponent(plan)}` : "/welcome";
  return (
    <div className="flex flex-col items-center gap-4">
      {/* Straight to guided setup — the default /dashboard fallback costs a new
          signup two extra redirect hops (dashboard → portal → welcome). */}
      <SignUp fallbackRedirectUrl={next} />
      <p className="max-w-xs text-center text-xs text-muted-foreground">
        By signing up you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
