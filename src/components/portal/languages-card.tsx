"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePortalProfileAction } from "@/lib/actions/portal";
import { initialActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import {
  LANGUAGE_OPTIONS,
  MAX_LANGUAGES,
  OPENING_LANGUAGES,
  languageOption,
  parseLanguages,
} from "@/lib/languages";

/**
 * Settings → Phone & AI: which languages the receptionist answers in.
 *
 * English only by default. The owner picks the language calls open in
 * (English or Spanish) and any others the AI may switch to when a caller
 * speaks them.
 */
export function LanguagesCard({
  clientId,
  languages,
  canEdit = true,
}: {
  clientId: string;
  languages: string | null | undefined;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const current = parseLanguages(languages);
  const [primary, setPrimary] = useState(current[0]);
  const [extras, setExtras] = useState<string[]>(current.slice(1));
  const [state, action, pending] = useActionState(savePortalProfileAction, initialActionState);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Saved.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const others = LANGUAGE_OPTIONS.filter((l) => l.code !== primary);
  const chosen = extras.filter((c) => c !== primary);
  const atMax = chosen.length + 1 >= MAX_LANGUAGES;

  function toggle(code: string, on: boolean) {
    setExtras((prev) => (on ? [...prev.filter((c) => c !== code), code] : prev.filter((c) => c !== code)));
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Languages</CardTitle>
        <CardDescription>
          Your AI can answer in the caller&apos;s language: it notices what they speak and switches,
          including the &ldquo;I&apos;m an AI&rdquo; notice and the permission-to-text question.
          Booking texts follow the language the customer spoke (Spanish texts are ready; other
          languages get English texts for now).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          <fieldset disabled={!canEdit} className="space-y-4">
            <Field label="Calls open in" hint="The language of your greeting.">
              <NativeSelect
                name="primaryLanguage"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
              >
                {OPENING_LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {languageOption(code)?.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Also answer in"
              hint={`Optional. Pick only what your callers actually speak: up to ${MAX_LANGUAGES - 1} extra. Every added language makes speech recognition a little less accurate.`}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {others.map((l) => {
                  const checked = chosen.includes(l.code);
                  return (
                    <label
                      key={l.code}
                      className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm has-[:disabled]:opacity-50"
                    >
                      <input
                        type="checkbox"
                        name="extraLanguages"
                        value={l.code}
                        checked={checked}
                        disabled={!checked && atMax}
                        onChange={(e) => toggle(l.code, e.target.checked)}
                      />
                      <span>
                        {l.label}
                        {l.native !== l.label ? (
                          <span className="ml-1 text-xs text-muted-foreground">{l.native}</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>
            <p className="text-xs text-muted-foreground">
              No extra charge from us. A multilingual AI uses a slightly slower, less precise
              speech model than English only, so leave this off unless callers need it. After
              saving, place a test call in each language.
            </p>
          </fieldset>
          {canEdit ? (
            <div className="flex justify-end">
              <SubmitButton pending={pending}>Save</SubmitButton>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Enter your team edit code to change this.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
