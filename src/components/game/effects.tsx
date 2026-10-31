"use client";

import { useEffect, useState } from "react";

const COLORS = ["#FFD24A", "#3EE0A1", "#6EA8FF", "#FF6B81", "#B4A0FF", "#FF8A3D"];

interface Piece {
  id: number;
  color: string;
  dx: number;
  dy: number;
  rot: number;
  wide: boolean;
}

function burst(seed: number): Piece[] {
  return Array.from({ length: 22 }, (_, i) => {
    const angle = (i / 22) * Math.PI * 2 + (i % 3) * 0.17;
    const distance = 120 + (i % 4) * 34;
    return {
      id: seed * 100 + i,
      color: COLORS[i % COLORS.length],
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance + 40,
      rot: (i * 47) % 360,
      wide: i % 2 === 0,
    };
  });
}

/**
 * A burst of confetti from the middle of the parent, once per change of
 * `fire` (zero fires nothing). The parent needs `position: relative`.
 */
export function Confetti({ fire }: { fire: number }) {
  const [pieces, setPieces] = useState<Piece[]>([]);

  useEffect(() => {
    if (fire === 0) return;
    // Starting a fresh burst is the point of this effect: `fire` is an event.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPieces(burst(fire));
    const timer = setTimeout(() => setPieces([]), 950);
    return () => clearTimeout(timer);
  }, [fire]);

  if (pieces.length === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute top-[42%] left-1/2 z-40 h-0 w-0">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="confetti-piece absolute -top-1 -left-1.5 rounded-[2px]"
          style={
            {
              width: piece.wide ? 13 : 8,
              height: piece.wide ? 7 : 13,
              background: piece.color,
              "--dx": `${piece.dx}px`,
              "--dy": `${piece.dy}px`,
              "--rot": `${piece.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export interface FloatText {
  id: number;
  text: string;
  color: string;
  /** Pixels down from the top of the parent. */
  top: number;
  size: number;
}

/** "+15 XP" and friends, rising and fading over the card. */
export function Floats({ items }: { items: FloatText[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0">
      {items.map((item) => (
        <span
          key={item.id}
          className="anim-float-up absolute inset-x-0 text-center font-extrabold [text-shadow:0_3px_0_rgba(0,0,0,.35)]"
          style={{ top: item.top, fontSize: item.size, color: item.color }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

/** Mix two #rrggbb colours; `t` 0 is all `a`, 1 is all `b`. */
export function mixColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const pa = parse(a);
  const pb = parse(b);
  const [r, g, bl] = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${r}, ${g}, ${bl})`;
}

/** A short buzz on phones that support it. Silently nothing elsewhere. */
export function buzz(ms = 12): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  } catch {
    // Some browsers throw when vibration is blocked; that is fine.
  }
}
