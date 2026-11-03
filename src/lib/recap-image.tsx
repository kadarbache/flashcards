import { ImageResponse } from "next/og";

import { BOSS_XP } from "@/lib/boss";
import type { Recap } from "@/lib/recap";

/**
 * The weekly recap as a picture to share: 1080 by 1350, the portrait shape
 * Instagram and WhatsApp show whole. Drawn in code, like the app icon.
 */

type Fonts = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]>;

export const RECAP_IMAGE_SIZE = { width: 1080, height: 1350 };

const FAMILY = "Bricolage Grotesque";
const WEIGHTS = [500, 800] as const;

let fonts: Promise<Fonts> | null = null;

/**
 * The app's own typeface, from Google Fonts, asked for once per server. The
 * picture only comes with a plain regular font, which makes the numbers look
 * thin. When Google cannot be reached, that plain font is used instead.
 */
export function recapFonts(): Promise<Fonts> {
  fonts ??= Promise.all(WEIGHTS.map(loadWeight)).catch(() => {
    fonts = null; // try again next time
    return [];
  });
  return fonts;
}

async function loadWeight(weight: (typeof WEIGHTS)[number]): Promise<Fonts[number]> {
  // Without a browser's user agent, Google answers with TrueType, which is what the picture reads.
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(FAMILY)}:opsz,wght@96,${weight}`,
    { signal: AbortSignal.timeout(5_000) },
  ).then((response) => response.text());
  const url = /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
  if (!url) throw new Error("Google Fonts sent no TrueType file.");
  const data = await fetch(url, { signal: AbortSignal.timeout(5_000) }).then((response) => {
    if (!response.ok) throw new Error(`Google Fonts answered ${response.status}.`);
    return response.arrayBuffer();
  });
  return { name: FAMILY, data, weight, style: "normal" };
}

const INK = "#F5F2FF";
const MUTED = "#A7A1C2";
const GOLD = "#FFD24A";
const FLAME = "#FF8A3D";

export async function recapImage(recap: Recap): Promise<ImageResponse> {
  const loaded = await recapFonts();
  const highlight = recap.bosses[0]
    ? {
        label: "Boss beaten",
        word: recap.bosses[0],
        note: recap.bosses.length > 1 ? `and ${recap.bosses.length - 1} more` : `+${BOSS_XP} XP`,
      }
    : recap.toughest
      ? { label: "Hardest word I got right", word: recap.toughest.front, note: `forgotten ${recap.toughest.lapses}×` }
      : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 72,
          color: INK,
          fontFamily: loaded.length > 0 ? FAMILY : undefined,
          background: "linear-gradient(165deg, #2a2150 0%, #0F0D1A 45%, #0F0D1A 72%, #2a1a12 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width={60} height={60} viewBox="0 0 32 32">
              <rect x="7" y="3.5" width="18" height="25" rx="4.5" fill={GOLD} transform="rotate(-8 16 16)" />
              <path d="M17.5 8.5 11 18h4.8l-1 5.8L21.3 14h-4.8l1-5.5z" fill="#16122B" />
            </svg>
            <span style={{ fontSize: 36, fontWeight: 800 }}>Flashcards</span>
          </div>
          <span style={{ fontSize: 34, fontWeight: 500, color: MUTED }}>{recap.range}</span>
        </div>

        <span
          style={{ marginTop: 64, fontSize: 36, fontWeight: 800, color: GOLD, letterSpacing: 5, textTransform: "uppercase" }}
        >
          {recap.current ? "My week so far" : "My week in words"}
        </span>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
          <span style={{ fontSize: 210, fontWeight: 800, lineHeight: 1, letterSpacing: -6 }}>
            {recap.answers.toLocaleString("en-US")}
          </span>
          <div style={{ display: "flex", flexDirection: "column", paddingBottom: 26, gap: 10 }}>
            <span style={{ fontSize: 46, fontWeight: 800 }}>cards answered</span>
            {recap.change !== null && (
              <Change percent={recap.change} label={recap.current ? "on this time last week" : "on last week"} />
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 52 }}>
          {recap.days.map((day) => (
            <div key={day.day} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 112,
                  height: 112,
                  borderRadius: 56,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: day.met ? FLAME : "#2a2342",
                  border: day.met ? "none" : `4px ${day.future ? "dashed" : "solid"} #3d3560`,
                }}
              >
                {day.met && (
                  <svg width={52} height={52} viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#2a1a12" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 30, fontWeight: 800, color: MUTED }}>{day.letter}</span>
            </div>
          ))}
        </div>
        <span style={{ marginTop: 18, fontSize: 32, fontWeight: 500, color: "#F2C9A8" }}>
          {recap.daysMet} of 7 days on goal{recap.streak > 1 ? ` · ${recap.streak}-day streak` : ""}
        </span>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 48 }}>
          <Stat value={recap.xp.toLocaleString("en-US")} label="XP earned" color={GOLD} />
          <Stat value={String(recap.learned)} label="words learned" color="#3EE0A1" />
          <Stat value={String(recap.bestCombo)} label="best combo" color="#6EA8FF" />
          <Stat value={String(recap.added)} label="words added" color={INK} />
          <Stat value={String(recap.minutes)} label="minutes" color={INK} />
          <Stat
            value={recap.word.answered > 0 ? `${recap.word.knew}/${recap.word.answered}` : "–"}
            label="words of the day"
            color={INK}
          />
        </div>

        {highlight && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              marginTop: "auto",
              padding: "30px 36px",
              borderRadius: 36,
              background: "#272010",
              border: "3px solid #5c4a14",
            }}
          >
            <svg width={72} height={72} viewBox="0 0 24 24">
              <path
                d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4"
                fill="none"
                stroke={GOLD}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: GOLD, letterSpacing: 3, textTransform: "uppercase" }}>
                {highlight.label}
              </span>
              <span style={{ fontSize: 52, fontWeight: 800 }}>{highlight.word}</span>
            </div>
            <span style={{ fontSize: 32, fontWeight: 500, color: MUTED }}>{highlight.note}</span>
          </div>
        )}
      </div>
    ),
    {
      ...RECAP_IMAGE_SIZE,
      fonts: loaded.length > 0 ? loaded : undefined,
      headers: { "cache-control": "private, no-store" },
    },
  );
}

/** "▲ 12% on last week", with the arrow drawn: the typeface has no arrow character. */
function Change({ percent, label }: { percent: number; label: string }) {
  const up = percent >= 0;
  const color = up ? "#3EE0A1" : MUTED;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 32, fontWeight: 500, color }}>
      <svg width={22} height={22} viewBox="0 0 24 24">
        <path d={up ? "M12 3 23 21H1z" : "M12 21 1 3h22z"} fill={color} />
      </svg>
      <span>
        {Math.abs(percent)}% {label}
      </span>
    </div>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div
      style={{
        width: 298,
        height: 158,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 30px",
        borderRadius: 32,
        background: "#1B1830",
      }}
    >
      <span style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, color }}>{value}</span>
      <span style={{ marginTop: 10, fontSize: 28, fontWeight: 500, color: MUTED }}>{label}</span>
    </div>
  );
}
