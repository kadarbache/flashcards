"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import {
  getServerSoundSetting,
  getSoundSetting,
  play,
  setSoundSetting,
  subscribeSoundSetting,
} from "@/components/game/sound";
import { CheckIcon, MuteIcon, SoundIcon } from "@/components/icons";
import { SOUND_PACKS, type SoundSetting } from "@/lib/sound";

const CHOICES: Array<{ id: SoundSetting; name: string; detail: string }> = [
  ...SOUND_PACKS,
  { id: "off", name: "Off", detail: "No sound" },
];

/**
 * The speaker in the header: pick a sound pack or turn sound off. Picking a
 * pack plays a sample of it. The choice is kept on this device only.
 */
export function SoundMenu() {
  const current = useSyncExternalStore(subscribeSoundSetting, getSoundSetting, getServerSoundSetting);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const name = CHOICES.find((choice) => choice.id === current)?.name ?? "Off";

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Sound: ${name}`}
        title={`Sound: ${name}`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-raised hover:text-ink"
      >
        {current === "off" ? <MuteIcon className="h-5 w-5" /> : <SoundIcon className="h-5 w-5" />}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Sound"
          className="anim-pop-in absolute top-12 right-0 z-40 w-60 rounded-2xl border border-border-subtle bg-surface-raised p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,.7)]"
        >
          <SoundChoices itemRole="menuitemradio" onChosen={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/**
 * The packs and "Off" as a list to pick from: inside the header's menu, or
 * on its own in the phone's "More" sheet. Picking a pack plays a sample.
 */
export function SoundChoices({
  itemRole,
  onChosen,
}: {
  itemRole: "menuitemradio" | "radio";
  onChosen?: () => void;
}) {
  const current = useSyncExternalStore(subscribeSoundSetting, getSoundSetting, getServerSoundSetting);

  function choose(next: SoundSetting) {
    setSoundSetting(next);
    onChosen?.();
    if (next !== "off") play("easy", 1);
  }

  return CHOICES.map((choice) => {
    const selected = choice.id === current;
    return (
      <button
        key={choice.id}
        type="button"
        role={itemRole}
        aria-checked={selected}
        onClick={() => choose(choice.id)}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-high ${selected ? "bg-surface-high" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{choice.name}</span>
          <span className="block text-xs text-ink-muted">{choice.detail}</span>
        </span>
        {selected && <CheckIcon className="h-4 w-4 shrink-0 text-good" />}
      </button>
    );
  });
}
