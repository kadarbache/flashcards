"use client";

import { useActionState } from "react";

import { updateDeckSettings, type FormState } from "@/app/actions";
import type { DeckSettings } from "@/lib/decks";
import { field, label, primaryButton } from "@/components/ui";

const initialState: FormState = { ok: false, message: "" };


export function SettingsForm({ deck }: { deck: DeckSettings }) {
  const [state, formAction, isPending] = useActionState(
    updateDeckSettings,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="deckId" value={deck.id} />

      <label className="block">
        <span className={label}>Name</span>
        <input name="name" defaultValue={deck.name} maxLength={120} className={field} />
      </label>

      <label className="block">
        <span className={label}>Description</span>
        <input
          name="description"
          defaultValue={deck.description}
          maxLength={500}
          className={field}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>
            Learning steps (minutes)
          </span>
          <input
            name="learningStepsMinutes"
            defaultValue={deck.learningStepsMinutes.join(", ")}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>
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
          className={primaryButton}
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
