"use client";

import { useEffect, useState } from "react";

import { DownloadIcon, ShareIcon } from "@/components/icons";
import { primaryButton, secondaryButton } from "@/components/ui";

type Picture = { file: File; url: string };

/**
 * Make the week's picture, then share or save it. Two taps on purpose: phones
 * only open the share sheet straight from a tap, and fetching the picture
 * first would use that tap up. So the first tap makes it and shows it, and
 * the second shares a file that is already there.
 */
export function ShareRecap({ monday, range }: { monday: string; range: string }) {
  const [picture, setPicture] = useState<Picture | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  // Let go of the picture's memory when it is replaced or the screen closes.
  useEffect(() => {
    return () => {
      if (picture) URL.revokeObjectURL(picture.url);
    };
  }, [picture]);

  async function make() {
    setMaking(true);
    setError(null);
    try {
      const response = await fetch(`/recap/image?week=${monday}`);
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], `my-week-${monday}.png`, { type: "image/png" });
      setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
      setPicture({ file, url: URL.createObjectURL(blob) });
    } catch {
      setError("The picture could not be made. Try again.");
    } finally {
      setMaking(false);
    }
  }

  async function share() {
    if (!picture) return;
    try {
      await navigator.share({ files: [picture.file], title: `My week in words, ${range}` });
    } catch (shareError) {
      // Closing the share sheet is not a failure.
      if ((shareError as Error).name !== "AbortError") setError("Sharing did not work here. Save the picture instead.");
    }
  }

  function save() {
    if (!picture) return;
    const link = document.createElement("a");
    link.href = picture.url;
    link.download = picture.file.name;
    link.click();
  }

  if (!picture) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => void make()} disabled={making} className={`${primaryButton} w-full`}>
          <ShareIcon className="h-5 w-5" />
          {making ? "Making your picture…" : "Make a picture to share"}
        </button>
        {error && <p className="text-center text-sm font-bold text-again">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* A blob URL, made just now in this browser: next/image has nothing to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={picture.url}
        alt={`Your week in words, ${range}`}
        className="anim-pop-in mx-auto aspect-[4/5] w-full max-w-xs rounded-2xl shadow-[0_28px_60px_-24px_rgba(0,0,0,.75)]"
      />
      <div className={`grid gap-2.5 ${canShare ? "grid-cols-2" : "grid-cols-1"}`}>
        {canShare && (
          <button type="button" onClick={() => void share()} className={primaryButton}>
            <ShareIcon className="h-5 w-5" />
            Share
          </button>
        )}
        <button type="button" onClick={save} className={canShare ? secondaryButton : primaryButton}>
          <DownloadIcon className="h-5 w-5" />
          Save picture
        </button>
      </div>
      {error && <p className="text-center text-sm font-bold text-again">{error}</p>}
    </div>
  );
}
