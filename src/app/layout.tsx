import type { Metadata } from "next";
import { Google_Sans } from "next/font/google";
import Link from "next/link";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={googleSans.variable}>
      <body className="min-h-dvh font-sans">
        <header className="border-b border-border-subtle">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Flashcards
            </Link>
            <span className="text-xs text-ink-muted">Spaced repetition</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
