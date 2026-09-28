import type { Metadata } from "next";
import { Google_Sans } from "next/font/google";
import Link from "next/link";

import { auth } from "@/auth";
import { signOutAction } from "@/app/login/actions";

import "./globals.css";

/**
 * Self-hosted by `next/font`, so there is no request to Google at runtime and
 * no layout shift. The family is variable across 400-700, so no weight list is
 * needed: any weight in that range is available from the one file.
 */
const googleSans = Google_Sans({
  subsets: ["latin"],
  variable: "--font-google-sans",
  display: "swap",
  // Next has no width metrics for this family, so it cannot build a
  // size-adjusted local fallback and warns on every single render. The CSS
  // fallback stack in globals.css covers the swap instead.
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Flashcards",
  description: "Spaced-repetition flashcards with Again / Hard / Good / Easy grading.",
};

/**
 * "Spaced repetition" when signed out, a sign-out button when signed in. The
 * layout renders on every page including `/login`, so it has to work in both
 * states rather than assume a session exists.
 */
async function SessionControls() {
  const session = await auth();
  if (!session?.user) {
    return <span className="text-xs text-ink-muted">Spaced repetition</span>;
  }

  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-full border border-border-subtle px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
      >
        Sign out
      </button>
    </form>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={googleSans.variable}>
      <body className="min-h-dvh font-sans">
        <header className="border-b border-border-subtle">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Flashcards
            </Link>
            <SessionControls />
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
