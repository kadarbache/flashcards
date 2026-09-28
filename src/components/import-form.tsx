"use client";

import { useActionState, useRef, useState } from "react";

import { importCards, type FormState } from "@/app/actions";
import { SEPARATORS, type SeparatorName } from "@/lib/import";

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
        className="w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-easy"
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          Separator
          <select
            value={separator}
            onChange={(event) => setSeparator(event.target.value as SeparatorName)}
            className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 text-xs"
          >
            {Object.keys(SEPARATORS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="cursor-pointer text-xs text-ink-muted underline-offset-4 hover:underline">
          or load a file
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
          className="ml-auto rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
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
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok ? "border-good/40 text-good" : "border-again/40 text-again"
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
