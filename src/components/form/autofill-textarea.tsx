"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { draftSetupTextAction } from "@/lib/actions/setup-draft";
import type { DraftField } from "@/lib/setup-draft";

type TextareaProps = Omit<
  React.ComponentProps<typeof Textarea>,
  "value" | "defaultValue" | "onChange"
>;

/**
 * A textarea with a "Fill in for me" button under it.
 *
 * The button asks the server for a starting draft written from what the
 * business already set up (see `lib/setup-draft.ts`) and puts it in the box.
 * It never saves: the owner edits it and presses the form's own Save.
 * It never silently replaces typing either: if the box has text, it asks
 * "Replace your text?" first, and after any fill there is an Undo.
 *
 * Works inside a plain uncontrolled form (pass `defaultValue`), or controlled
 * (pass `value` + `onValueChange`) when something else, like "Fill all the
 * empty boxes", needs to set it too.
 */
export function AutofillTextarea({
  clientId,
  field,
  defaultValue = "",
  value: controlled,
  onValueChange,
  serviceNameField,
  buttonLabel = "Fill in for me",
  ...textareaProps
}: TextareaProps & {
  clientId: string;
  field: DraftField;
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  /** For service descriptions: the `name` of the input in the same form that holds the service name. */
  serviceNameField?: string;
  buttonLabel?: string;
}) {
  const [inner, setInner] = useState(defaultValue);
  const value = controlled ?? inner;
  const setValue = onValueChange ?? setInner;

  const [pending, startTransition] = useTransition();
  const [askReplace, setAskReplace] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);

  // The confirm row appears under the button: move focus into it so keyboard
  // and screen-reader users land on the question.
  useEffect(() => {
    if (askReplace) replaceRef.current?.focus();
  }, [askReplace]);

  function run() {
    setAskReplace(false);
    setStatus(null);
    const serviceName = serviceNameField
      ? ((
          textRef.current?.form?.elements.namedItem(serviceNameField) as
            | HTMLInputElement
            | null
        )?.value ?? "")
      : undefined;
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof draftSetupTextAction>>;
      try {
        res = await draftSetupTextAction({ clientId, field, serviceName });
      } catch {
        res = { ok: false, error: "We couldn't write a suggestion just now. Try again." };
      }
      if (!res.ok) {
        setStatus({ kind: "error", text: res.error });
        textRef.current?.focus();
        return;
      }
      setPrevious(value);
      setValue(res.text);
      setStatus({ kind: "ok", text: `Suggestion added, not saved yet. ${res.note}` });
      textRef.current?.focus();
    });
  }

  function onFillClick() {
    if (value.trim()) {
      setAskReplace(true);
      setStatus(null);
    } else {
      run();
    }
  }

  function undo() {
    if (previous === null) return;
    setValue(previous);
    setPrevious(null);
    setStatus({ kind: "ok", text: "Put your text back." });
    textRef.current?.focus();
  }

  return (
    <div className="space-y-2">
      <Textarea
        {...textareaProps}
        ref={textRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-sm:h-9 max-sm:px-3"
          onClick={onFillClick}
          disabled={pending}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {pending ? "Writing…" : buttonLabel}
        </Button>
        {previous !== null && !askReplace ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-sm:h-9 max-sm:px-3"
            onClick={undo}
          >
            <Undo2 />
            Undo
          </Button>
        ) : null}
      </div>
      {askReplace ? (
        <div
          role="group"
          aria-label="Replace your text?"
          className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm">
            Replace your text with a suggestion? You can undo it.
          </p>
          <div className="flex gap-2">
            <Button
              ref={replaceRef}
              type="button"
              size="sm"
              className="max-sm:h-9 max-sm:px-3"
              onClick={run}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-sm:h-9 max-sm:px-3"
              onClick={() => {
                setAskReplace(false);
                textRef.current?.focus();
              }}
            >
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={
          status?.kind === "error"
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {status?.text ?? ""}
      </p>
    </div>
  );
}
