/**
 * Shared class strings, so every screen's buttons and fields look like one
 * app. Plain strings rather than components: they go on links, buttons and
 * inputs alike.
 */

export const field =
  "w-full rounded-2xl border border-border-subtle bg-surface-high px-4 py-3 text-base text-ink placeholder:text-ink-muted/60 outline-none transition focus:border-gold";

export const label = "mb-1.5 block text-sm font-semibold text-ink-muted";

/** The gold call to action. One per screen, ideally. */
export const primaryButton =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gold px-5 text-base font-extrabold text-paper-ink transition active:scale-[0.97] disabled:opacity-50";

export const secondaryButton =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-surface-high px-5 text-base font-bold text-ink transition hover:bg-[#2f2a4a] active:scale-[0.97] disabled:opacity-50";

/** Small round icon button, e.g. back arrows and the card menu. */
export const iconButton =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-raised text-ink transition hover:bg-surface-high active:scale-95 disabled:opacity-35";

export const panel = "rounded-3xl bg-surface-raised p-5 sm:p-6";
