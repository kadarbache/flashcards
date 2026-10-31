import type { Metadata } from "next";

import { LogoMark } from "@/components/icons";

export const metadata: Metadata = { title: "Offline · Flashcards" };

/**
 * What the service worker shows when a page cannot load. It is saved when the
 * app is installed, so it must work with no network: plain HTML, and the
 * "try again" is an ordinary link rather than a script.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-sm space-y-5 py-12 text-center">
      <LogoMark className="mx-auto h-16 w-16 opacity-80" />
      <h1 className="text-3xl font-extrabold tracking-tight">You&apos;re offline</h1>
      <p className="text-ink-muted">
        Your cards and streak live on the server, so the app needs a connection. Your progress is
        safe. Come back when you&apos;re online.
      </p>
      {/* A full page load on purpose: it goes back through the network check. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-gold px-6 font-extrabold text-paper-ink"
      >
        Try again
      </a>
    </div>
  );
}
