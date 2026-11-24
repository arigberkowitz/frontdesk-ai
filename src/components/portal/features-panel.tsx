"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  CalendarClock,
  CalendarHeart,
  Clock,
  Globe,
  HandCoins,
  Languages,
  ListOrdered,
  MessageSquareText,
  MoonStar,
  PhoneCall,
  PhoneForwarded,
  PhoneMissed,
  Repeat,
  Sparkles,
  Star,
  Sun,
  UserRound,
  Users,
  Mail,
  BellRing,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/panel-header";
import { FeatureSwitchRow, toForm, type ServerAction } from "@/components/portal/feature-switch-row";
import { savePortalProfileAction } from "@/lib/actions/portal";
import { setHandoffModeAction } from "@/lib/actions/spam";
import { setStaffModeAction } from "@/lib/actions/providers";
import { saveAiTextRepliesSettingsAction } from "@/lib/actions/sms-ai";
import { saveMissedCallSettingsAction } from "@/lib/actions/missed-call-settings";
import { saveSmartRebookingSettingsAction } from "@/lib/actions/rebooking";
import {
  saveChatWidgetSettingsAction,
  saveDepositSettingsAction,
  saveRecallSettingsAction,
  saveReviewRequestSettingsAction,
  saveWaitlistSettingsAction,
} from "@/lib/actions/growth-settings";
import { setSetupFlagAction } from "@/lib/actions/setup";
import { initialActionState } from "@/lib/actions/types";
import {
  applyFeatureChange,
  FEATURE_GROUPS,
  featureFields,
  featureRows,
  type FeatureFacts,
  type FeatureLimits,
  type FeatureRowView,
  type FeatureToggleKey,
} from "@/lib/feature-toggles";

/** Which existing server action owns each setting. */
const ACTIONS: Record<FeatureToggleKey, ServerAction> = {
  transfer: setHandoffModeAction,
  transferOpenHoursOnly: setHandoffModeAction,
  offerHuman: savePortalProfileAction,
  spanish: savePortalProfileAction,
  staffMode: setStaffModeAction,
  aiTextReplies: saveAiTextRepliesSettingsAction,
  missedCallTexts: saveMissedCallSettingsAction,
  aiCallbacks: saveMissedCallSettingsAction,
  smartRebooking: saveSmartRebookingSettingsAction,
  recoveryTexts: savePortalProfileAction,
  reviewRequests: saveReviewRequestSettingsAction,
  recall: saveRecallSettingsAction,
  waitlist: saveWaitlistSettingsAction,
  deposits: saveDepositSettingsAction,
  smsAlerts: savePortalProfileAction,
  weeklySummary: savePortalProfileAction,
  dailyBriefing: savePortalProfileAction,
  morningUnbookedText: savePortalProfileAction,
  chatWidget: saveChatWidgetSettingsAction,
};

const ICONS: Record<FeatureToggleKey, LucideIcon> = {
  transfer: PhoneForwarded,
  transferOpenHoursOnly: Clock,
  offerHuman: UserRound,
  spanish: Languages,
  staffMode: Users,
  aiTextReplies: Bot,
  missedCallTexts: PhoneMissed,
  aiCallbacks: PhoneCall,
  smartRebooking: CalendarClock,
  recoveryTexts: Repeat,
  reviewRequests: Star,
  recall: CalendarHeart,
  waitlist: ListOrdered,
  deposits: HandCoins,
  smsAlerts: BellRing,
  weeklySummary: Mail,
  dailyBriefing: Sun,
  morningUnbookedText: MoonStar,
  chatWidget: Globe,
};

/**
 * The full on/off list. Owns a copy of the settings so a sub-switch (e.g.
 * "Only while you're open") appears the moment its parent is turned on, and
 * warnings follow the switches without a reload.
 */
export function FeaturesPanel({
  clientId,
  isAdmin,
  facts: initialFacts,
  limits,
  bookingEnabled,
  setupMode,
}: {
  clientId: string;
  isAdmin: boolean;
  facts: FeatureFacts;
  limits: FeatureLimits;
  bookingEnabled: boolean;
  setupMode: boolean;
}) {
  const [facts, setFacts] = useState(initialFacts);
  const rows = featureRows(facts, limits, { bookingEnabled });
  const children = (key: FeatureToggleKey) => rows.filter((r) => r.parent === key);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const renderRow = (row: FeatureRowView, nested = false): React.ReactNode => {
    const kids = children(row.key);
    const parentOn = byKey.get(row.key)?.on;
    return (
      <FeatureSwitchRow
        // Remount when a parent change resets this row on the server
        // (e.g. the AI call-back clears whenever the text-back switch changes).
        key={`${row.key}:${row.parent ? String(byKey.get(row.parent)?.on) : ""}`}
        nested={nested}
        icon={nested ? undefined : ICONS[row.key]}
        title={row.title}
        description={row.summary}
        explainer={row.explainer}
        initialOn={row.on}
        isAdmin={isAdmin}
        action={ACTIONS[row.key]}
        form={(on) => toForm(featureFields(row.key, clientId, on, facts))}
        onSaved={(on) => setFacts((f) => applyFeatureChange(f, row.key, on))}
        confirmNotes={row.confirmNotes}
        locked={row.locked}
        needs={row.needs}
        fixed={row.fixed}
        warning={row.warning}
      >
        {parentOn && kids.length ? kids.map((k) => renderRow(k, true)) : null}
      </FeatureSwitchRow>
    );
  };

  return (
    <div className="space-y-6">
      {setupMode ? <SetupStepIntro clientId={clientId} canEdit={isAdmin} /> : null}
      {FEATURE_GROUPS.map((g) => {
        const top = rows.filter((r) => r.group === g.key && !r.parent);
        if (top.length === 0) return null;
        return (
          <Card key={g.key} id={`features-${g.key}`} className="scroll-mt-24">
            <CardContent className="p-5 sm:p-6">
              <PanelHeader icon={GROUP_ICONS[g.key]} title={g.title} description={g.description} />
              <ul className="mt-4 divide-y divide-border/70">{top.map((r) => renderRow(r))}</ul>
            </CardContent>
          </Card>
        );
      })}
      {isAdmin ? null : (
        <p className="text-xs text-muted-foreground">Only your account owner can turn these on or off.</p>
      )}
      {setupMode ? <SetupStepFooter clientId={clientId} canEdit={isAdmin} /> : null}
    </div>
  );
}

const GROUP_ICONS: Record<(typeof FEATURE_GROUPS)[number]["key"], LucideIcon> = {
  calls: PhoneCall,
  customerTexts: MessageSquareText,
  forYou: Sparkles,
  website: Globe,
};

function SetupStepIntro({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  return (
    <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-4 sm:p-5">
      <p className="text-xs font-medium tracking-wide text-indigo-600 uppercase">Setup · optional step</p>
      <p className="mt-1 font-heading text-lg font-semibold tracking-tight">Choose your features</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Turn on what you want and leave the rest. Not sure what one does? Tap “What&apos;s this?” under it.
        Nothing here is required, and you can change any of it later.
      </p>
      {canEdit ? (
        <div className="mt-3">
          <ContinueButtons clientId={clientId} />
        </div>
      ) : null}
    </div>
  );
}

function SetupStepFooter({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">Changes save as you flip them.</p>
      <ContinueButtons clientId={clientId} />
    </div>
  );
}

/** "Continue setup" / "Skip for now": both just mark the optional step seen and go back. */
function ContinueButtons({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(setSetupFlagAction, initialActionState);
  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Saved.");
      router.push("/portal");
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form action={action} className="flex flex-wrap gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="flag" value="featuresReviewed" />
      <input type="hidden" name="value" value="true" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Done, back to setup"}
      </Button>
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Skip for now
      </Button>
    </form>
  );
}
