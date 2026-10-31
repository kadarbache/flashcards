"use client";

import { useActionState } from "react";

import { signInWithPassword, type LoginState } from "@/app/login/actions";
import { field, label, primaryButton } from "@/components/ui";

const initialState: LoginState = { error: null };


export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, isPending] = useActionState(
    signInWithPassword,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <label className="block">
        <span className={label}>Email</span>
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
        <span className={label}>Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={field}
        />
      </label>

      {state.error !== null && (
        <p className="rounded-2xl border border-again/40 bg-again/10 px-4 py-3 text-sm text-again" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className={`${primaryButton} w-full`}
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
