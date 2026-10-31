"use client";

import { useActionState } from "react";

import { createDeck, type FormState } from "@/app/actions";
import { field, label, primaryButton } from "@/components/ui";

const initialState: FormState = { ok: false, message: "" };

export function DeckForm() {
  const [state, formAction, isPending] = useActionState(createDeck, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className={label}>Deck name</span>
        <input
          name="name"
          required
          maxLength={120}
          placeholder="English vocabulary"
          className={field}
        />
      </label>

      <label className="block">
        <span className={label}>
          Description <span className="font-normal">(optional)</span>
        </span>
        <input
          name="description"
          maxLength={500}
          className={field}
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className={primaryButton}
        >
          {isPending ? "Creating..." : "Create deck"}
        </button>
        {state.message !== "" && (
          <p className="text-sm text-again" role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
