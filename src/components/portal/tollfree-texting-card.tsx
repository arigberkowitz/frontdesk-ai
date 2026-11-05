"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, MessageSquare, XCircle } from "lucide-react";
import { saveTollfreeDetailsAction } from "@/lib/actions/tollfree";
import { initialActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { BUSINESS_TYPES, MONTHLY_VOLUMES } from "@/lib/tollfree/details";
import type { TollfreeView } from "@/lib/tollfree/status";
import { cn } from "@/lib/utils";

const TONE = {
  neutral: { icon: MessageSquare, box: "border-border bg-muted/40", icon_: "text-muted-foreground" },
  pending: { icon: Clock, box: "border-amber-500/40 bg-amber-500/5", icon_: "text-amber-600" },
  ok: { icon: CheckCircle2, box: "border-emerald-500/40 bg-emerald-500/5", icon_: "text-emerald-600" },
  bad: { icon: XCircle, box: "border-red-500/40 bg-red-500/5", icon_: "text-red-600" },
} as const;

/**
 * Settings → Phone & AI → Texting. The business's own toll-free texting
 * number: its carrier-approval status and, until approved, the business
 * details carriers need (owner-only).
 */
export function TollfreeTextingCard({
  clientId,
  view,
  phoneNumber,
  details,
  einOnFile,
  isOwner,
}: {
  clientId: string;
  view: TollfreeView;
  phoneNumber: string | null;
  /** Saved details, minus the EIN. */
  details: Record<string, string>;
  /** Last 4 of the EIN on file, if any. */
  einOnFile: string | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveTollfreeDetailsAction, initialActionState);
  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Saved.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = TONE[view.tone];
  const Icon = t.icon;
  const err = (k: string) => state.fieldErrors?.[k];
  const v = (k: string) => details[k] ?? "";

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Texting number</CardTitle>
        <CardDescription>
          Your customers&apos; confirmations and reminders come from your own toll-free number
          {phoneNumber ? <> (<span className="font-medium text-foreground">{phoneNumber}</span>)</> : null}. Carriers
          approve each business before it can text.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div role="status" className={cn("flex items-start gap-3 rounded-lg border p-3", t.box)}>
          <Icon className={cn("mt-0.5 size-5 shrink-0", t.icon_)} />
          <div className="space-y-1">
            <p className="text-sm font-medium">{view.title}</p>
            <p className="text-xs text-muted-foreground">{view.body}</p>
          </div>
        </div>

        {view.showForm && !isOwner ? (
          <p className="text-xs text-muted-foreground">Only the business owner can enter these details.</p>
        ) : null}

        {view.showForm && isOwner ? (
          <form action={action} className="space-y-4">
            <input type="hidden" name="clientId" value={clientId} />
            <p className="text-xs text-muted-foreground">
              Use your business&apos;s legal details exactly as registered. Carriers check them.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Legal business name" error={err("legalName")}>
                <Input name="legalName" defaultValue={v("legalName")} autoComplete="organization" />
              </Field>
              <Field label="Business type" error={err("businessType")}>
                <NativeSelect name="businessType" defaultValue={v("businessType") || "SOLE_PROPRIETOR"}>
                  {BUSINESS_TYPES.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="EIN (optional for sole proprietors)"
                hint={einOnFile ? `On file: •••••${einOnFile}. Leave blank to keep it.` : "9 digits, e.g. 12-3456789"}
                error={err("ein")}
              >
                <Input name="ein" inputMode="numeric" autoComplete="off" />
              </Field>
              <Field label="Website" error={err("website")}>
                <Input name="website" defaultValue={v("website")} placeholder="https://" />
              </Field>
              <Field label="Street address" error={err("street")} className="sm:col-span-2">
                <Input name="street" defaultValue={v("street")} autoComplete="street-address" />
              </Field>
              <Field label="City" error={err("city")}>
                <Input name="city" defaultValue={v("city")} autoComplete="address-level2" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="State" error={err("state")}>
                  <Input name="state" defaultValue={v("state")} maxLength={2} placeholder="NY" />
                </Field>
                <Field label="ZIP" error={err("postalCode")}>
                  <Input name="postalCode" defaultValue={v("postalCode")} inputMode="numeric" />
                </Field>
              </div>
              <Field label="Contact first name" error={err("contactFirstName")}>
                <Input name="contactFirstName" defaultValue={v("contactFirstName")} autoComplete="given-name" />
              </Field>
              <Field label="Contact last name" error={err("contactLastName")}>
                <Input name="contactLastName" defaultValue={v("contactLastName")} autoComplete="family-name" />
              </Field>
              <Field label="Contact email" error={err("contactEmail")}>
                <Input name="contactEmail" type="email" defaultValue={v("contactEmail")} autoComplete="email" />
              </Field>
              <Field label="Contact phone" error={err("contactPhone")}>
                <Input name="contactPhone" type="tel" defaultValue={v("contactPhone")} autoComplete="tel" />
              </Field>
              <Field label="Texts per month (estimate)" error={err("monthlyVolume")}>
                <NativeSelect name="monthlyVolume" defaultValue={v("monthlyVolume") || "1,000"}>
                  {MONTHLY_VOLUMES.map((m) => (
                    <option key={m} value={m}>
                      Up to {m}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="flex justify-end">
              <SubmitButton pending={pending}>{view.submitLabel}</SubmitButton>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
