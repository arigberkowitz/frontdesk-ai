"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import { startCheckoutAction } from "@/lib/actions/billing";
import { initialActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { PLANS, planList } from "@/config/plans";
import { formatCurrencyCents } from "@/lib/format";

export type BillingInfo = {
  stripeReady: boolean;
  testMode: boolean;
  subscription: {
    status: string;
    plan: string | null;
    monthlyPriceCents: number | null;
    currentPeriodEnd: Date | null;
  } | null;
};

function CheckoutButton() {
  const { pending } = useFormStatus();
  return <SubmitButton pending={pending}>Start checkout</SubmitButton>;
}

const LIVE_STATUSES = ["active", "trialing", "past_due"];

export function BillingCard({ clientId, billing }: { clientId: string; billing: BillingInfo }) {
  const [state, action] = useActionState(startCheckoutAction, initialActionState);
  const sub = billing.subscription;
  const active = sub && LIVE_STATUSES.includes(sub.status);
  const planName = sub?.plan ? (PLANS[sub.plan as keyof typeof PLANS]?.name ?? sub.plan) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Billing</CardTitle>
          {billing.testMode ? <Badge variant="secondary">Stripe test mode</Badge> : null}
        </div>
        <CardDescription>
          Charge this client a monthly or yearly subscription plus the one-time setup fee.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!billing.stripeReady ? (
          <p className="text-sm text-amber-600">
            Add <code>STRIPE_SECRET_KEY</code> to your environment to enable billing.
          </p>
        ) : active && sub ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span>
                <strong>{planName}</strong> — {sub.status}
                {sub.monthlyPriceCents ? ` · ${formatCurrencyCents(sub.monthlyPriceCents)}/mo` : ""}
                {sub.currentPeriodEnd
                  ? ` · renews ${sub.currentPeriodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : ""}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage or cancel from your Stripe dashboard. Webhook updates this automatically.
            </p>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <input type="hidden" name="clientId" value={clientId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Plan">
                <NativeSelect name="plan" defaultValue="pro">
                  {planList().map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} — {formatCurrencyCents(p.monthlyPriceCents)}/mo + {formatCurrencyCents(p.setupFeeCents)} setup
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Billing period" hint="Yearly = 2 months free.">
                <NativeSelect name="interval" defaultValue="month">
                  <option value="month">Monthly</option>
                  <option value="year">Yearly (save ~17%)</option>
                </NativeSelect>
              </Field>
            </div>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                A 100%-off code can be entered on the checkout page.
              </p>
              <CheckoutButton />
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
