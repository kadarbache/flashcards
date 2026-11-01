"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AlbumIcon, ArrowIcon, MedalIcon } from "@/components/icons";
import { field, iconButton, panel, primaryButton } from "@/components/ui";
import { optionText } from "@/lib/blitz";
import {
  nextTier,
  progressToNext,
  TIER_DAYS,
  TIER_LABEL,
  tierFor,
  type Tier,
  type TierCounts,
} from "@/lib/collection";
import type { Collection, CollectionWord } from "@/lib/collection-db";

type Filter = "all" | Tier | "locked";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "gold", label: "Gold" },
  { id: "silver", label: "Silver" },
  { id: "bronze", label: "Bronze" },
  { id: "locked", label: "Not yet" },
];

/** Sticker colours per rank, on the dark ground. */
const STICKER: Record<Tier | "locked", { card: string; bar: string; text: string }> = {
  gold: {
    card: "border-[#FFD24A]/60 bg-gradient-to-br from-[#3b2d07] to-[#211a08]",
    bar: "bg-gold",
    text: "text-gold",
  },
  silver: {
    card: "border-[#C9D3E6]/45 bg-gradient-to-br from-[#2a3048] to-[#1b1f31]",
    bar: "bg-[#C9D3E6]",
    text: "text-[#C9D3E6]",
  },
  bronze: {
    card: "border-[#D99A62]/45 bg-gradient-to-br from-[#33220f] to-[#22170d]",
    bar: "bg-[#D99A62]",
    text: "text-[#E5AE7C]",
  },
  locked: {
    card: "border-dashed border-border-subtle bg-transparent",
    bar: "bg-border-subtle",
    text: "text-ink-muted",
  },
};

/**
 * The album: every card as a sticker with its medal. Bronze once learned,
 * Silver when it holds for three weeks, Gold for three months. Tap a sticker
 * to see the meaning.
 */
export function CollectionAlbum({ data }: { data: Collection }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const { counts } = data;
  const collected = counts.gold + counts.silver + counts.bronze;

  const decks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.decks
      .map((deck) => ({
        ...deck,
        words: deck.words.filter((word) => {
          const rank = tierFor(word) ?? "locked";
          if (filter !== "all" && rank !== filter) return false;
          return needle === "" || word.front.toLowerCase().includes(needle);
        }),
      }))
      .filter((deck) => deck.words.length > 0);
  }, [data.decks, filter, query]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <Link href="/" className={iconButton} aria-label="Back to home">
          <ArrowIcon direction="left" className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-extrabold tracking-tight">Your collection</h1>
          <p className="text-sm text-ink-muted tabular-nums">
            {collected} of {counts.total} words collected
          </p>
        </div>
      </div>

      <Summary counts={counts} />

      {counts.total === 0 ? (
        <div className={`${panel} px-6 py-12 text-center`}>
          <AlbumIcon className="mx-auto h-12 w-12 text-gold" />
          <h2 className="mt-3 text-2xl font-extrabold">The album is empty</h2>
          <p className="mt-2 text-ink-muted">Add some cards to a deck, and every one gets a slot here.</p>
          <Link href="/" className={`${primaryButton} mt-5`}>
            Go to your decks
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0" role="group" aria-label="Show">
              {FILTERS.map((option) => {
                const on = filter === option.id;
                const count =
                  option.id === "all" ? counts.total : counts[option.id as keyof TierCounts];
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFilter(option.id)}
                    aria-pressed={on}
                    className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold transition ${
                      on ? "bg-gold text-paper-ink" : "bg-surface-raised text-ink-muted hover:text-ink"
                    }`}
                  >
                    {option.label}
                    <span className={`tabular-nums ${on ? "text-paper-ink/70" : "text-ink-muted/70"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a word"
              aria-label="Find a word"
              className={`${field} py-2 sm:ml-auto sm:max-w-56`}
            />
          </div>

          {decks.length === 0 ? (
            <p className={`${panel} text-center text-ink-muted`}>No words match.</p>
          ) : (
            decks.map((deck) => (
              <section key={deck.id} className="space-y-3">
                <h2 className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-lg font-extrabold">{deck.name}</span>
                  <span className="flex gap-3 text-xs font-bold text-ink-muted tabular-nums">
                    <span className="text-gold">{deck.counts.gold} gold</span>
                    <span className="text-[#C9D3E6]">{deck.counts.silver} silver</span>
                    <span className="text-[#E5AE7C]">{deck.counts.bronze} bronze</span>
                  </span>
                </h2>
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {deck.words.map((word) => (
                    <Sticker key={word.id} word={word} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

function Summary({ counts }: { counts: TierCounts }) {
  const total = Math.max(1, counts.total);
  return (
    <section className={`${panel} space-y-4`}>
      <dl className="grid grid-cols-3 gap-2.5">
        {(["gold", "silver", "bronze"] as const).map((tier) => (
          <div key={tier} className="flex flex-col items-center rounded-2xl bg-surface-high px-2 py-3.5">
            <MedalIcon tier={tier} className="h-10 w-10" />
            <dd className={`mt-1 text-3xl leading-none font-extrabold tabular-nums ${STICKER[tier].text}`}>
              {counts[tier]}
            </dd>
            <dt className="mt-1 text-xs font-semibold text-ink-muted">{TIER_LABEL[tier]}</dt>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <div className="flex h-3 gap-[3px] overflow-hidden rounded-full bg-surface-high" aria-hidden="true">
          <div className="bg-gold" style={{ flex: counts.gold / total }} />
          <div className="bg-[#C9D3E6]" style={{ flex: counts.silver / total }} />
          <div className="bg-[#D99A62]" style={{ flex: counts.bronze / total }} />
          <div style={{ flex: counts.locked / total }} />
        </div>
        <p className="text-xs text-ink-muted">
          <b className="text-[#E5AE7C]">Bronze</b> once you learn a word.{" "}
          <b className="text-[#C9D3E6]">Silver</b> when it sticks for {TIER_DAYS.silver} days.{" "}
          <b className="text-gold">Gold</b> when it sticks for {TIER_DAYS.gold}. Keep answering Good
          and words climb on their own. Forget one and it drops back to Bronze.
        </p>
      </div>
    </section>
  );
}

function Sticker({ word }: { word: CollectionWord }) {
  const [open, setOpen] = useState(false);
  const tier = tierFor(word);
  const rank = tier ?? "locked";
  const style = STICKER[rank];
  const next = nextTier(tier);
  const progress = progressToNext(word);

  let hint: string;
  if (tier === null) hint = "Learn it to collect";
  else if (word.state === "relearning") hint = "Slipped. Relearning now";
  else if (next === null) hint = `Gold · holds ${word.intervalDays}d`;
  else hint = `${TIER_LABEL[next]} at ${TIER_DAYS[next]}d · now ${word.intervalDays}d`;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className={`flex h-full min-h-28 w-full flex-col gap-2 rounded-2xl border-2 p-3 text-left transition hover:brightness-110 active:scale-[0.98] ${style.card}`}
      >
        <span className="flex items-start justify-between gap-2">
          <span
            className={`min-w-0 font-extrabold break-words ${tier ? "text-ink" : "text-ink-muted"} ${
              word.front.length > 14 ? "text-sm" : "text-base"
            }`}
          >
            {word.front}
          </span>
          <MedalIcon tier={rank} className={`h-7 w-7 shrink-0 ${tier ? "" : "opacity-60"}`} />
        </span>
        {open ? (
          <span className="line-clamp-4 text-xs leading-snug text-ink">{optionText(word.back, 140)}</span>
        ) : (
          <span className="mt-auto space-y-1.5">
            <span className="block h-1.5 overflow-hidden rounded-full bg-black/30" aria-hidden="true">
              <span className={`block h-full rounded-full ${style.bar}`} style={{ width: `${progress * 100}%` }} />
            </span>
            <span className={`block text-[11px] leading-tight font-semibold ${style.text}`}>{hint}</span>
          </span>
        )}
      </button>
    </li>
  );
}
