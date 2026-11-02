import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import Link from "next/link";

import { auth } from "@/auth";
import { signOutAction } from "@/app/login/actions";
import { HelpIcon, HomeIcon, LogoMark, SignOutIcon } from "@/components/icons";
import { PwaSetup } from "@/components/pwa";
import { SoundMenu } from "@/components/sound-menu";

import "./globals.css";

/**
 * Self-hosted by `next/font`, so there is no request to Google at runtime and
 * no layout shift. One variable family covers body text and the big numbers.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Flashcards",
  description: "Spaced-repetition flashcards you play like a game.",
  applicationName: "Flashcards",
  // iPhone reads these when the app is added to the home screen.
  appleWebApp: { capable: true, title: "Flashcards", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0F0D1A",
  colorScheme: "dark",
  // Lets the page run under the notch; the header and main pad themselves back
  // in with the safe-area insets.
  viewportFit: "cover",
};

/**
 * Navigation when signed in, nothing when signed out. The layout renders on
 * every page including `/login`, so it cannot assume a session.
 */
async function SessionControls() {
  const session = await auth();
  if (!session?.user) return null;

  const navLink =
    "inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-bold text-ink-muted transition hover:bg-surface-raised hover:text-ink";

  return (
    <nav className="flex items-center gap-1" aria-label="Main">
      <Link href="/" className={navLink}>
        <HomeIcon className="h-5 w-5" />
        <span className="hidden sm:inline">Home</span>
      </Link>
      <Link href="/help" className={navLink}>
        <HelpIcon className="h-5 w-5" />
        <span className="hidden sm:inline">How to play</span>
      </Link>
      <SoundMenu />
      <form action={signOutAction}>
        {/* An icon on phones, where the header has no room for the words. */}
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="ml-1 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle text-sm font-semibold whitespace-nowrap text-ink-muted transition hover:text-ink sm:w-auto sm:px-3"
        >
          <SignOutIcon className="h-5 w-5 sm:hidden" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </form>
    </nav>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={display.variable}>
      <body className="min-h-dvh font-sans">
        <PwaSetup />
        <header className="sticky top-0 z-30 border-b border-white/5 bg-ground/75 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl wide:max-w-none items-center justify-between gap-3 px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] py-2.5 sm:px-[max(1.5rem,env(safe-area-inset-left),env(safe-area-inset-right))]">
            <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <LogoMark className="h-8 w-8" />
              Flashcards
            </Link>
            <SessionControls />
          </div>
        </header>
        <main className="mx-auto max-w-6xl wide:max-w-none px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:px-[max(1.5rem,env(safe-area-inset-left),env(safe-area-inset-right))] sm:pt-8">
          {children}
        </main>
      </body>
    </html>
  );
}
