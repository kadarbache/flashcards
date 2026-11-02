"use client";

import { useEffect, useRef } from "react";

/**
 * A panel that slides up from the bottom on a phone and sits in the middle of
 * a wider screen. The native dialog gives Escape, focus trapping and the
 * dimmed backdrop for free; a click on the backdrop closes it too.
 *
 * The content is only rendered while it is open, so it starts fresh each time.
 * A field marked `data-autofocus` gets the focus when it opens.
 */
export function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        // A click on the dimmed backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      aria-label={label}
      className="mx-0 mt-auto mb-0 max-h-[88dvh] w-full max-w-full overflow-y-auto rounded-t-3xl bg-surface-raised p-0 text-ink backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      {open && children}
    </dialog>
  );
}
