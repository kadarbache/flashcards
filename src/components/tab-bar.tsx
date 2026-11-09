"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { signOutAction } from "@/app/login/actions";
import { DeckForm } from "@/components/deck-form";
import {
  AlbumIcon,
  BossIcon,
  ChartIcon,
  CloseIcon,
  HelpIcon,
  HomeIcon,
  PlusIcon,
  SearchIcon,
  SignOutIcon,
  SunIcon,
  UserIcon,
  VideoIcon,
} from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { SoundChoices } from "@/components/sound-menu";
import { iconButton, secondaryButton } from "@/components/ui";

/**
 * Screens without the bar: signing in, and the games, which fill the screen
 * and have their own way back.
 */
const HIDDEN = /^\/(login|offline)(\/|$)|^\/decks\/[^/]+\/(review|practice|blitz)(\/|$)/;

const TABS = [
  {
    href: "/",
    label: "Home",
    Icon: HomeIcon,
    match: (path: string) => path === "/" || path.startsWith("/decks/"),
  },
  {
    href: "/watch",
    label: "Watch & learn",
    Icon: VideoIcon,
    match: (path: string) => path.startsWith("/watch"),
  },
  {
    href: "/word",
    label: "Word of the Day",
    Icon: SunIcon,
    match: (path: string) => path.startsWith("/word"),
  },
];

const tab = "flex h-12 w-12 items-center justify-center rounded-full transition active:scale-90";
const tabOn = "bg-gold/15 text-gold";
const tabOff = "text-ink-muted hover:text-ink";

/**
 * The navigation on phones, at the bottom where a thumb reaches it, in place
 * of the header. Home, videos, a big button for a new deck, Word of the Day,
 * and "More" for the boss, the weekly recap, the album, help, sound and
 * signing out.
 */
export function TabBar() {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<"new" | "more" | null>(null);
  const [sheetPath, setSheetPath] = useState(pathname);

  // Landing on another page closes whatever was open: after creating a deck,
  // say, which opens the new deck's page.
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    setSheet(null);
  }

  if (HIDDEN.test(pathname)) return null;

  const close = () => setSheet(null);
  const [home, watch, word] = TABS;
  const moreActive =
    sheet === "more" ||
    ["/find", "/collection", "/help", "/boss", "/recap"].some((path) => pathname.startsWith(path));

  return (
    <>
      <nav
        data-tabbar
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-white/5 bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-14px_32px_-14px_rgba(0,0,0,.7)] backdrop-blur-md md:hidden typing:hidden"
      >
        <ul className="mx-auto flex h-[4.25rem] max-w-md items-center justify-around px-4">
          <li>
            <TabLink {...home} active={home.match(pathname)} />
          </li>
          <li>
            <TabLink {...watch} active={watch.match(pathname)} />
          </li>
          <li>
            <button
              type="button"
              onClick={() => setSheet("new")}
              aria-label="New deck"
              aria-haspopup="dialog"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-gold text-paper-ink shadow-[0_8px_20px_-6px_rgba(255,210,74,.5)] transition active:scale-90"
            >
              <PlusIcon className="h-7 w-7" />
            </button>
          </li>
          <li>
            <TabLink {...word} active={word.match(pathname)} />
          </li>
          <li>
            <button
              type="button"
              onClick={() => setSheet("more")}
              aria-label="More"
              aria-haspopup="dialog"
              className={`${tab} ${moreActive ? tabOn : tabOff}`}
            >
              <UserIcon className="h-6 w-6" />
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={sheet === "new"} onClose={close} label="New deck">
        <div className={sheetBody}>
          <SheetTitle title="New deck" onClose={close} />
          <DeckForm autoFocus />
        </div>
      </Sheet>

      <Sheet open={sheet === "more"} onClose={close} label="More">
        <div className={sheetBody}>
          <SheetTitle title="More" onClose={close} />
          <ul className="space-y-1">
            <li>
              <Link href="/find" onClick={close} className={row}>
                <SearchIcon className="h-5 w-5 text-easy" />
                <span>
                  <span className="block font-bold">Find a word</span>
                  <span className="block text-xs text-ink-muted">Describe a word you forgot to find its card</span>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/boss" onClick={close} className={row}>
                <BossIcon className="h-5 w-5 text-again" />
                <span>
                  <span className="block font-bold">Boss fight</span>
                  <span className="block text-xs text-ink-muted">The word you keep forgetting, and your trophies</span>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/recap" onClick={close} className={row}>
                <ChartIcon className="h-5 w-5 text-easy" />
                <span>
                  <span className="block font-bold">Your week</span>
                  <span className="block text-xs text-ink-muted">What the week added up to, to share</span>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/collection" onClick={close} className={row}>
                <AlbumIcon className="h-5 w-5 text-gold" />
                <span>
                  <span className="block font-bold">Collection</span>
                  <span className="block text-xs text-ink-muted">Your word album and its medals</span>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/help" onClick={close} className={row}>
                <HelpIcon className="h-5 w-5 text-gold" />
                <span>
                  <span className="block font-bold">How to play</span>
                  <span className="block text-xs text-ink-muted">Reviews, practice, blitz and streaks</span>
                </span>
              </Link>
            </li>
          </ul>
          <section className="space-y-1">
            <h3 className="px-3 text-xs font-extrabold tracking-wide text-ink-muted uppercase">Sound</h3>
            <div role="radiogroup" aria-label="Sound">
              <SoundChoices itemRole="radio" />
            </div>
          </section>
          <form action={signOutAction}>
            <button type="submit" className={`${secondaryButton} w-full`}>
              <SignOutIcon className="h-5 w-5" />
              Sign out
            </button>
          </form>
        </div>
      </Sheet>
    </>
  );
}

const sheetBody = "space-y-5 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:p-6";
const row = "flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-surface-high";

function TabLink({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`${tab} ${active ? tabOn : tabOff}`}
    >
      <Icon className="h-6 w-6" />
    </Link>
  );
}

function SheetTitle({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
      <button type="button" className={iconButton} aria-label="Close" onClick={onClose}>
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
