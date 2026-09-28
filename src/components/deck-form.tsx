"use client";

import { useActionState } from "react";

import { createDeck, type FormState } from "@/app/actions";

const initialState: FormState = { ok: false, message: "" };

export function DeckForm() {
  const [state, formAction, isPending] = useActionState(createDeck, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Deck name</span>
        <input
          name="name"
          required
          maxLength={120}
          placeholder="English vocabulary"
          className="w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-sm outline-none focus:border-easy"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">
          Description <span className="font-normal">(optional)</span>
        </span>
        <input
          name="description"
          maxLength={500}
          className="w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-sm outline-none focus:border-easy"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
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
