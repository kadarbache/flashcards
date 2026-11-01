"use client";

import { useEffect, useState } from "react";

import { disableReminders, enableReminders, testReminder } from "@/app/actions";
import { BellIcon } from "@/components/icons";
import { isIos, isStandalone } from "@/components/pwa";
import { primaryButton, secondaryButton } from "@/components/ui";

type Status =
  | "checking"
  /** The browser cannot do push at all. The card stays hidden. */
  | "unsupported"
  /** iPhone in a Safari tab: push only works from the Home Screen app. */
  | "install-first"
  /** Development server: the service worker only runs in a production build. */
  | "dev"
  | "unconfigured"
  | "blocked"
  | "off"
  | "on";

/** The VAPID public key as the bytes `pushManager.subscribe` wants. */
function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function workerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  }
  return navigator.serviceWorker.ready;
}

/**
 * The evening reminder switch. Each phone or computer turns it on for itself:
 * the browser asks permission, hands over a push address, and the server keeps
 * it until reminders are turned off or the address stops working.
 */
export function ReminderCard({ publicKey, time }: { publicKey: string | null; time: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (next: Status) => {
      if (!cancelled) setStatus(next);
    };

    async function check() {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return settle(isIos() && !isStandalone() ? "install-first" : "unsupported");
      if (process.env.NODE_ENV !== "production") return settle("dev");
      if (!publicKey) return settle("unconfigured");
      if (Notification.permission === "denied") return settle("blocked");

      const registration = await workerRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return settle("off");
      if (!cancelled) setEndpoint(subscription.endpoint);
      settle("on");
      // Keep the server's copy (and this device's time zone) current.
      void enableReminders(subscription.toJSON()).catch(() => {});
    }

    check().catch(() => settle("unsupported"));
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await workerRegistration();
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const saved = await enableReminders(subscription.toJSON());
      if (!saved.ok) {
        await subscription.unsubscribe();
        setNote(saved.message);
        setStatus("off");
        return;
      }
      setEndpoint(subscription.endpoint);
      setStatus("on");
    } catch {
      setNote("Reminders could not be turned on here.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setNote(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      const address = subscription?.endpoint ?? endpoint;
      await subscription?.unsubscribe();
      if (address) await disableReminders(address);
      setEndpoint(null);
      setStatus("off");
    } catch {
      setNote("Reminders could not be turned off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!endpoint) return;
    setBusy(true);
    setNote(null);
    try {
      setNote((await testReminder(endpoint)).message);
    } catch {
      setNote("The test could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking" || status === "unsupported") return null;

  let text: string;
  switch (status) {
    case "install-first":
      text = "On iPhone, add the app to your Home Screen first, then turn reminders on from there.";
      break;
    case "dev":
      text = "Reminders work in the deployed app, not on the development server.";
      break;
    case "unconfigured":
      text = "Reminders are not set up on the server yet.";
      break;
    case "blocked":
      text = "Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.";
      break;
    case "on":
      text = `On for this device. Around ${time}, if your goal or today's word still needs you, you'll get a nudge.`;
      break;
    default:
      text = `Get a nudge around ${time} when your streak is about to break.`;
  }

  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-surface-raised p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex flex-1 items-center gap-4">
        <span
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
            status === "on" ? "bg-good text-paper-ink" : "bg-surface-high text-ink-muted"
          }`}
        >
          <BellIcon className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold">Evening reminder</h2>
          <p className="text-sm text-ink-muted">{text}</p>
          {note && (
            <p className="mt-1 text-sm font-bold text-gold" role="status">
              {note}
            </p>
          )}
        </div>
      </div>
      {status === "off" && (
        <button type="button" onClick={() => void turnOn()} disabled={busy} className={primaryButton}>
          <BellIcon className="h-5 w-5" />
          Turn on
        </button>
      )}
      {status === "on" && (
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button type="button" onClick={() => void sendTest()} disabled={busy} className={secondaryButton}>
            Send a test
          </button>
          <button type="button" onClick={() => void turnOff()} disabled={busy} className={secondaryButton}>
            Turn off
          </button>
        </div>
      )}
    </section>
  );
}
