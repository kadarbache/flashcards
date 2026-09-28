"use client";

import { useActionState } from "react";

import { updateDeckSettings, type FormState } from "@/app/actions";
import type { DeckSettings } from "@/lib/decks";

const initialState: FormState = { ok: false, message: "" };

const field =
  "w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-sm outline-none focus:border-easy";

export function SettingsForm({ deck }: { deck: DeckSettings }) {
  const [state, formAction, isPending] = useActionState(
    updateDeckSettings,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="deckId" value={deck.id} />

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Name</span>
        <input name="name" defaultValue={deck.name} maxLength={120} className={field} />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Description</span>
        <input
          name="description"
          defaultValue={deck.description}
          maxLength={500}
          className={field}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">
            Learning steps (minutes)
          </span>
          <input
            name="learningStepsMinutes"
            defaultValue={deck.learningStepsMinutes.join(", ")}
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-muted">
            Relearning steps (minutes)
          </span>
          <input
            name="relearningStepsMinutes"
            defaultValue={deck.relearningStepsMinutes.join(", ")}
            className={field}
          />
        </label>
      </div>

      <p className="text-xs text-ink-muted">
        A new card walks the learning steps before it gets a real interval. A card that
        gets <span className="text-again">Again</span> in review walks the relearning
        steps instead. Leave relearning empty to skip it.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save settings"}
        </button>
        {state.message !== "" && (
          <p className={`text-sm ${state.ok ? "text-good" : "text-again"}`} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
