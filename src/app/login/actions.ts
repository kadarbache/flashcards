"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";

export interface LoginState {
  error: string | null;
}

/**
 * Where to go after signing in.
 *
 * Only same-site paths are honoured. Without this check the `callbackUrl`
 * parameter is an open redirect: a link to our own login page could bounce
 * someone to an attacker's copy of it after they authenticate, which is a
 * phishing primitive rather than a convenience. A leading `//` is rejected too,
 * since `//evil.test` is a protocol-relative URL, not a path.
 */
function safeCallback(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function signInWithPassword(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safeCallback(formData.get("callbackUrl")),
    });
  } catch (error) {
    // A successful sign-in throws a redirect, which is not an AuthError and
    // has to keep travelling or the browser never moves.
    if (error instanceof AuthError) {
      return { error: "Wrong email or password." };
    }
    throw error;
  }

  return { error: null };
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
