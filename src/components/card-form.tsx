"use client";

import { useActionState, useEffect, useRef } from "react";

import { createCard, type FormState } from "@/app/actions";

const initialState: FormState = { ok: false, message: "" };

const field =
  "w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-sm outline-none focus:border-easy";

/** Add one card at a time: a question and an answer, nothing else to think about. */
export function CardForm({ deckId }: { deckId: string }) {
  const [state, formAction, isPending] = useActionState(createCard, initialState);
  const form = useRef<HTMLFormElement>(null);
  const firstField = useRef<HTMLTextAreaElement>(null);

  // Clear the fields after a save so the next card can be typed straight away.
  useEffect(() => {
    if (state.ok) {
      form.current?.reset();
      firstField.current?.focus();
    }
  }, [state]);

  return (
    <form ref={form} action={formAction} className="space-y-3">
      <input type="hidden" name="deckId" value={deckId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Question</span>
          <textarea
            ref={firstField}
            name="front"
            rows={3}
            required
            placeholder="hola"
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Answer</span>
          <textarea name="back" rows={3} required placeholder="hello" className={field} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
        >
          {isPending ? "Adding..." : "Add card"}
        </button>
        {state.message !== "" && (
          <p
            className={`text-sm ${state.ok ? "text-good" : "text-again"}`}
            role="status"
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
