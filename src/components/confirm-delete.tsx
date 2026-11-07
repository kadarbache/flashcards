"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { buzz } from "@/components/game/effects";
import { play } from "@/components/game/sound";
import { TrashIcon } from "@/components/icons";
import { secondaryButton } from "@/components/ui";

/** How long the delete button has to be held down. */
export const HOLD_MS = 2000;

/**
 * The one way anything gets deleted: a dialog that names what is going, and a
 * button that has to be held down for two seconds. A stray tap, a click or a
 * bump of the Enter key does nothing, and letting go early starts it over.
 *
 * Cancel, Escape and a tap on the dimmed backdrop all close it. It stays open
 * while the delete runs, and says so if it fails, so the hold can be tried again.
 */
export function ConfirmDelete({
  open,
  onClose,
  title,
  name,
  detail,
  holdLabel = "Hold to delete",
  busyLabel = "Deleting…",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** The question, e.g. "Delete this deck?" */
  title: string;
  /** What goes: the deck's name, the card's front. */
  name: string;
  /** What else goes with it, and that it cannot be undone. */
  detail: string;
  holdLabel?: string;
  /** Shown on the button while the delete runs. */
  busyLabel?: string;
  /** The delete itself. The dialog closes once it resolves. */
  onConfirm: () => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  /** Where the focus was before it opened, to hand it back after. */
  const returnTo = useRef<HTMLElement | null>(null);
  /** A press that starts on the hold button and ends on the backdrop is not a backdrop tap. */
  const pressedBackdrop = useRef(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Bumped after a failure, so the hold button starts over empty. */
  const [attempt, setAttempt] = useState(0);
  const ids = useId();
  const titleId = `${ids}-title`;
  const detailId = `${ids}-detail`;
  const hintId = `${ids}-hint`;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      // Cancel is the safe choice, so it gets the focus.
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  function close() {
    if (pending) return;
    setError(null);
    onClose();
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await onConfirm();
        onClose();
      } catch {
        setError("That did not go through. Try again.");
        setAttempt((count) => count + 1);
        play("wrong");
      }
    });
  }

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      // React passes close and cancel up its own tree, which would also close
      // a sheet this dialog was opened from. Keep them here.
      onCancel={(event) => {
        event.stopPropagation();
        if (pending) event.preventDefault();
      }}
      onClose={(event) => {
        event.stopPropagation();
        const target = returnTo.current;
        returnTo.current = null;
        if (target?.isConnected) target.focus();
        close();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        event.stopPropagation();
        // A tap on the dimmed backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget && pressedBackdrop.current) close();
        pressedBackdrop.current = false;
      }}
      className="mx-0 mt-auto mb-0 w-full max-w-full rounded-t-3xl bg-surface-raised p-0 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-md sm:rounded-3xl"
    >
      {open && (
        <div className="space-y-5 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-again/15 text-again">
              <TrashIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-xl font-extrabold tracking-tight">
                {title}
              </h2>
              <p className="mt-0.5 font-bold break-words text-again">“{name}”</p>
            </div>
          </div>

          <p id={detailId} className="text-sm text-ink-muted">
            {detail}
          </p>

          {error && (
            <p role="alert" className="text-sm font-bold text-again">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                data-autofocus
                onClick={close}
                disabled={pending}
                className={`${secondaryButton} sm:flex-none`}
              >
                Cancel
              </button>
              <HoldButton
                key={attempt}
                label={holdLabel}
                busyLabel={busyLabel}
                busy={pending}
                describedBy={hintId}
                onHeld={confirm}
              />
            </div>
            <p id={hintId} className="text-center text-xs text-ink-muted sm:text-right">
              Press and hold for {HOLD_MS / 1000} seconds. Letting go early stops it.
            </p>
          </div>
        </div>
      )}
    </dialog>
  );
}

/**
 * A button that fires only after being held down for `HOLD_MS`, by mouse,
 * finger, Space or Enter. A red fill sweeps across while it is held; letting
 * go early drains it. With reduced motion the fill steps in quarters instead
 * of sweeping.
 */
export function HoldButton({
  label,
  busyLabel,
  busy,
  describedBy,
  onHeld,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  describedBy?: string;
  onHeld: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const frame = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function paint(progress: number) {
    button.current?.style.setProperty("--hold", String(progress));
  }

  function start() {
    if (busy || done || startedAt.current !== null) return;
    const stepped = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    startedAt.current = performance.now();
    setHolding(true);
    play("arm");
    buzz(8);

    let ticks = 0;
    const step = (now: number) => {
      if (startedAt.current === null) return;
      const elapsed = now - startedAt.current;
      const progress = Math.min(1, elapsed / HOLD_MS);
      paint(stepped ? Math.floor(progress * 4) / 4 : progress);

      // A tick each half second, so a held button feels like it is counting.
      const tick = Math.floor(elapsed / 500);
      if (tick > ticks && progress < 1) {
        ticks = tick;
        play("clock");
      }

      if (progress < 1) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      frame.current = null;
      startedAt.current = null;
      paint(1);
      setHolding(false);
      setDone(true);
      buzz(30);
      play("back");
      onHeld();
    };
    frame.current = requestAnimationFrame(step);
  }

  function stop() {
    if (startedAt.current === null) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    startedAt.current = null;
    setHolding(false);
    paint(0);
  }

  const text = busy || done ? busyLabel : holding ? "Keep holding…" : label;
  const isHoldKey = (key: string) => key === " " || key === "Enter";

  return (
    <button
      ref={button}
      type="button"
      // Not `disabled`: that would throw the focus out of the dialog mid-delete.
      aria-disabled={busy || done}
      aria-describedby={describedBy}
      data-holding={holding ? "" : undefined}
      // No onClick: a click alone must never delete.
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => {
        if (!isHoldKey(event.key)) return;
        // Stops Enter from clicking and Space from scrolling.
        event.preventDefault();
        if (!event.repeat) start();
      }}
      onKeyUp={(event) => {
        if (isHoldKey(event.key)) stop();
      }}
      onBlur={stop}
      // A long press on a phone would open the share/copy menu.
      onContextMenu={(event) => event.preventDefault()}
      className="group relative inline-flex min-h-12 flex-1 touch-none items-center justify-center overflow-hidden rounded-2xl border border-again/50 bg-again/10 px-5 text-base font-extrabold text-again [-webkit-touch-callout:none] [-webkit-user-select:none] select-none [--hold:0] aria-disabled:cursor-progress"
    >
      <span className="inline-flex items-center gap-2">
        <TrashIcon className="h-5 w-5" />
        {text}
      </span>
      {/* The same label in the filled colours, uncovered left to right as the hold goes on. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 inline-flex items-center justify-center gap-2 bg-again text-paper-ink transition-[clip-path] duration-200 ease-out [clip-path:inset(0_calc((1-var(--hold))*100%)_0_0)] group-data-[holding]:transition-none motion-reduce:transition-none"
      >
        <TrashIcon className="h-5 w-5" />
        {text}
      </span>
      <span className="sr-only" aria-live="polite">
        {holding ? "Keep holding" : busy || done ? busyLabel : ""}
      </span>
    </button>
  );
}

/**
 * A delete button for a server page: opens the dialog, and once the hold is
 * done sends `fields` to the server action as form data, the way the old
 * form did.
 */
export function DeleteButton({
  action,
  fields,
  title,
  name,
  detail,
  className,
  ariaLabel,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  title: string;
  name: string;
  detail: string;
  className: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className={className}
        onClick={() => {
          play("tap");
          setOpen(true);
        }}
      >
        {children}
      </button>
      <ConfirmDelete
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        name={name}
        detail={detail}
        onConfirm={() => {
          const data = new FormData();
          for (const [key, value] of Object.entries(fields)) data.set(key, value);
          return action(data);
        }}
      />
    </>
  );
}
