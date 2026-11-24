"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, CalendarClock, MoonStar, PhoneCall, PhoneMissed, Sparkles, Sun } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "@/components/panel-header";
import { saveAiTextRepliesSettingsAction } from "@/lib/actions/sms-ai";
import { saveMissedCallSettingsAction } from "@/lib/actions/missed-call-settings";
import { saveSmartRebookingSettingsAction } from "@/lib/actions/rebooking";
import { savePortalProfileAction } from "@/lib/actions/portal";
import { switchboardFields, type FeatureStatus } from "@/lib/ai-features";
import { confirmNotesFor, FEATURE_EXPLAINERS } from "@/lib/feature-toggles";
import { FeatureSwitchRow as FeatureRow, toForm } from "@/components/portal/feature-switch-row";

export interface AiFeaturesCardProps {
  clientId: string;
  /** Owner/admin (or operator). Everyone else sees the status, read-only. */
  isAdmin: boolean;
  aiTextReplies: { enabled: boolean; pauseHours: number; status: FeatureStatus; bookingEnabled: boolean };
  missedCall: {
    enabled: boolean;
    status: FeatureStatus;
    /** The AI phone callback — only rendered when the platform env var allows it. */
    aiCallbacksAvailable: boolean;
    aiCallbacksEnabled: boolean;
  };
  smartRebooking: { enabled: boolean; status: FeatureStatus };
  dailyBriefing: { enabled: boolean; status: FeatureStatus; ownerEmail: string | null };
  morningUnbookedText: { enabled: boolean; status: FeatureStatus };
  /** Plain-language limits repeated from Settings → Follow-ups. */
  limits: { repliesPerThreadPerDay: number; callbackDedupeDays: number; callbacksPerDay: number; rebookOfferHours: number };
}

/**
 * Overview → "AI features": one on/off switch per optional AI job, with a
 * one-line description and what it did lately. It posts to the SAME server
 * actions (and so the same admin-only checks) as the cards in Settings →
 * Follow-ups / Alerts. Turning on anything that texts or calls customers asks
 * once, with the consent and texting-hours rules in front of the owner.
 */
export function AiFeaturesCard(p: AiFeaturesCardProps) {
  const { clientId, isAdmin, limits } = p;
  // The AI call-back sub-switch rides on the main text-back switch: it shows
  // only while texts are on, and starts from "off" after any change to the
  // main switch (the server clears it whenever texts are switched).
  const [missedOn, setMissedOn] = useState(p.missedCall.enabled);
  const [mainChanges, setMainChanges] = useState(0);

  return (
    <Card id="ai-features" className="scroll-mt-24">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Sparkles}
          title="AI features"
          description="Extra jobs your AI can take on. Switch any of them on or off whenever you like."
          action={
            <Link
              href="/portal/settings/follow-ups"
              className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              More options
            </Link>
          }
        />
        <ul className="mt-4 divide-y divide-border/70">
          <FeatureRow
            icon={Bot}
            title="AI text replies"
            explainer={FEATURE_EXPLAINERS.aiTextReplies}
            description="Answers customer texts from your services, hours and FAQ, and can book or move appointments."
            status={p.aiTextReplies.status}
            initialOn={p.aiTextReplies.enabled}
            isAdmin={isAdmin}
            action={saveAiTextRepliesSettingsAction}
            form={(on) => toForm(switchboardFields("aiTextReplies", clientId, on, { pauseHours: p.aiTextReplies.pauseHours }))}
            confirmNotes={confirmNotesFor("aiTextReplies", limits, { bookingEnabled: p.aiTextReplies.bookingEnabled })}
          />
          <FeatureRow
            icon={PhoneMissed}
            title="Missed-call text-back"
            explainer={FEATURE_EXPLAINERS.missedCallTexts}
            description="Texts callers who hung up, got cut off or left mid-booking, offering to finish by text."
            status={p.missedCall.status}
            initialOn={p.missedCall.enabled}
            isAdmin={isAdmin}
            action={saveMissedCallSettingsAction}
            // Flipping the main switch never turns the AI phone callback on;
            // that's its own, separate yes below.
            form={(on) => toForm(switchboardFields("missedCallTexts", clientId, on))}
            onSaved={(on) => {
              setMissedOn(on);
              setMainChanges((n) => n + 1);
            }}
            confirmNotes={confirmNotesFor("missedCallTexts", limits)}
          >
            {p.missedCall.aiCallbacksAvailable && missedOn ? (
              <FeatureRow
                key={mainChanges}
                nested
                icon={PhoneCall}
                title="AI calls them back instead"
                explainer={FEATURE_EXPLAINERS.aiCallbacks}
                description="Your AI phones them from your number and says it's an AI. If it can't, they get the text."
                status={null}
                initialOn={mainChanges === 0 ? p.missedCall.aiCallbacksEnabled : false}
                isAdmin={isAdmin}
                action={saveMissedCallSettingsAction}
                form={(on) => toForm(switchboardFields("aiCallbacks", clientId, on))}
                confirmNotes={confirmNotesFor("aiCallbacks", limits)}
              />
            ) : null}
          </FeatureRow>
          <FeatureRow
            icon={CalendarClock}
            title="Smart rebooking"
            explainer={FEATURE_EXPLAINERS.smartRebooking}
            description="When you block time over bookings, text those customers 2–3 new times to pick from."
            status={p.smartRebooking.status}
            initialOn={p.smartRebooking.enabled}
            isAdmin={isAdmin}
            action={saveSmartRebookingSettingsAction}
            form={(on) => toForm(switchboardFields("smartRebooking", clientId, on))}
            confirmNotes={confirmNotesFor("smartRebooking", limits)}
          />
          <FeatureRow
            icon={Sun}
            title="Morning briefing"
            explainer={FEATURE_EXPLAINERS.dailyBriefing}
            description={
              p.dailyBriefing.ownerEmail
                ? `A short email each morning (7–10am your time) with yesterday's calls and today's schedule, to ${p.dailyBriefing.ownerEmail}.`
                : "A short email each morning (7–10am your time) with yesterday's calls and today's schedule."
            }
            status={p.dailyBriefing.status}
            statusLink={
              p.dailyBriefing.status.tone === "warn"
                ? { href: "/portal/settings/alerts", label: "Add an alerts email" }
                : undefined
            }
            initialOn={p.dailyBriefing.enabled}
            isAdmin={isAdmin}
            action={savePortalProfileAction}
            // The profile action patches only the fields it's sent — just this flag.
            form={(on) => toForm(switchboardFields("dailyBriefing", clientId, on))}
            confirmNotes={null}
          />
          <FeatureRow
            icon={MoonStar}
            title="Morning text: who didn't book"
            explainer={FEATURE_EXPLAINERS.morningUnbookedText}
            description="A text each morning (8–11am your time) listing last night's after-hours callers who didn't book, with what they wanted and a link to each. No text when there's nobody."
            status={p.morningUnbookedText.status}
            statusLink={
              p.morningUnbookedText.status.tone === "warn" && p.morningUnbookedText.status.text.includes("text alerts")
                ? { href: "/portal/settings/alerts", label: "Turn on text alerts" }
                : undefined
            }
            initialOn={p.morningUnbookedText.enabled}
            isAdmin={isAdmin}
            action={savePortalProfileAction}
            // Goes only to you (your text-alert numbers), never to customers.
            form={(on) => toForm(switchboardFields("morningUnbookedText", clientId, on))}
            confirmNotes={null}
          />
        </ul>
        {isAdmin ? null : (
          <p className="mt-3 text-xs text-muted-foreground">
            Only your account owner can turn these on or off.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
