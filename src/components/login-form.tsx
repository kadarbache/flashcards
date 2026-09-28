"use client";

import { useActionState } from "react";

import { signInWithPassword, type LoginState } from "@/app/login/actions";

const initialState: LoginState = { error: null };

const field =
  "w-full rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-sm outline-none focus:border-easy";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, isPending] = useActionState(
    signInWithPassword,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          className={field}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-muted">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={field}
        />
      </label>

      {state.error !== null && (
        <p className="rounded-md border border-again/40 px-3 py-2 text-sm text-again">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="h-11 w-full rounded-md bg-ink text-sm font-medium text-surface transition disabled:opacity-50"
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
