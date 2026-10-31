"use client";

import { useActionState, useRef, useState } from "react";

import { importCards, type FormState } from "@/app/actions";
import { SEPARATORS, type SeparatorName } from "@/lib/import";
import { field, primaryButton } from "@/components/ui";

const initialState: FormState = { ok: false, message: "" };

const PLACEHOLDER = `bonjour\thello
merci\tthank you
# lines starting with # are ignored`;

export function ImportForm({ deckId }: { deckId: string }) {
  const [state, formAction, isPending] = useActionState(importCards, initialState);
  const [separator, setSeparator] = useState<SeparatorName>("tab");
  const textarea = useRef<HTMLTextAreaElement>(null);

  /** Drop a .csv/.tsv/.txt straight into the textarea so it can be checked. */
  async function loadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !textarea.current) return;

    textarea.current.value = await file.text();
    if (file.name.endsWith(".csv")) setSeparator("comma");
    event.target.value = "";
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="deckId" value={deckId} />
      <input type="hidden" name="separator" value={separator} />

      <textarea
        ref={textarea}
        name="text"
        rows={6}
        spellCheck={false}
        placeholder={PLACEHOLDER}
        className={`${field} font-mono text-sm`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
          Separator
          <select
            value={separator}
            onChange={(event) => setSeparator(event.target.value as SeparatorName)}
            className="rounded-xl border border-border-subtle bg-surface-high px-3 py-2 text-sm text-ink"
          >
            {Object.keys(SEPARATORS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="cursor-pointer rounded-full bg-surface-high px-4 py-2 text-sm font-bold text-ink transition hover:bg-border-subtle">
          Load a file
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={loadFile}
            className="hidden"
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className={`${primaryButton} ml-auto`}
        >
          {isPending ? "Importing..." : "Import"}
        </button>
      </div>

      <p className="text-xs text-ink-muted">
        One card per line: front, then the separator, then back. A line containing a tab
        is always split on the tab.
      </p>

      {state.message !== "" && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            state.ok ? "border-good/40 bg-good/10 text-good" : "border-again/40 bg-again/10 text-again"
          }`}
          role="status"
        >
          <p>{state.message}</p>
          {state.details && state.details.length > 0 && (
            <ul className="mt-2 space-y-0.5 font-mono text-xs text-ink-muted">
              {state.details.slice(0, 10).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
              {state.details.length > 10 && (
                <li>...and {state.details.length - 10} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
