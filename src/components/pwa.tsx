"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { CloseIcon, DownloadIcon } from "@/components/icons";
import { primaryButton } from "@/components/ui";

/**
 * Runs once per page load:
 *
 * - tells the server the player's time zone, so "today" and the streak follow
 *   their own midnight rather than the server's;
 * - registers the service worker that makes the app installable and gives it
 *   an offline screen. Production only: in development it would cache build
 *   files that hot reload keeps replacing.
 */
export function PwaSetup() {
  const router = useRouter();

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const current = document.cookie.match(/(?:^|; )tz=([^;]*)/)?.[1];
    if (zone && (current === undefined || decodeURIComponent(current) !== zone)) {
      document.cookie = `tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // No service worker just means no offline screen; the app still works.
      });
  }, []);

  return null;
}

/** Chrome's install event, which is not in the DOM types yet. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "install-card-dismissed";

function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * "Put it on your home screen." Android and desktop Chrome get a real install
 * button; iPhone gets the two taps Safari needs, since it has no install event.
 * Hidden once installed, or after it is closed.
 */
export function InstallCard() {
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => true);
  const ios = useSyncExternalStore(() => () => {}, isIos, () => false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let stored = false;
    try {
      stored = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Storage blocked: just show the card.
    }
    // Reading storage can only happen after mount; it decides the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(stored);

    function onPrompt(event: Event) {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone || dismissed || (!prompt && !ios)) return null;

  function close() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Not remembered; it will show again next visit.
    }
  }

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  }

  return (
    <section className="relative flex flex-col gap-3 rounded-3xl border border-[#1e3a70] bg-[#10234a] p-5 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-start gap-3">
        <DownloadIcon className="mt-0.5 h-6 w-6 shrink-0 text-easy" />
        <div className="pr-8 sm:pr-0">
          <h2 className="text-lg font-extrabold">Put it on your home screen</h2>
          {ios && !prompt ? (
            <p className="mt-1 text-sm text-[#c9d8f5]">
              In Safari, tap the Share button, then <b>Add to Home Screen</b>. It opens
              full screen, like an app.
            </p>
          ) : (
            <p className="mt-1 text-sm text-[#c9d8f5]">
              Install it and it opens full screen, like an app, straight from your home
              screen or dock.
            </p>
          )}
        </div>
      </div>
      {prompt && (
        <button type="button" onClick={() => void install()} className={primaryButton}>
          <DownloadIcon className="h-5 w-5" />
          Install app
        </button>
      )}
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="absolute top-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-[#c9d8f5] hover:bg-white/10"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </section>
  );
}
