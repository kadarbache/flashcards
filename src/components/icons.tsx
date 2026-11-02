/**
 * The app's icons. Line icons take `currentColor`; the flame, bolt, star and
 * heart are filled, because they read as game pieces rather than controls.
 * All of them are decorative, so they are hidden from screen readers: the
 * control or label next to them carries the meaning.
 */

type IconProps = { className?: string };

function Line({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "h-5 w-5"}
    >
      {children}
    </svg>
  );
}

export function FlameIcon({ className, lit = true }: IconProps & { lit?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "h-5 w-5"}>
      <path
        d="M12 1.5c.7 3.6 3.5 5.5 5.2 8.1 2.1 3.2 1.4 7.7-1.6 10A7 7 0 0 1 4.8 14.2c0-2.7 1.3-4.7 2.9-6.1-.1 2.1.8 3.7 2.2 4.4-.7-4 .4-7.8 2.1-11z"
        fill={lit ? "#FF8A3D" : "#4A4468"}
      />
      <path
        d="M12 11.5c.6 1.7 2.2 2.6 2.2 4.4a2.3 2.3 0 0 1-4.6.2c0-1.1.5-1.9 1.2-2.5 0 .8.3 1.3.9 1.6-.2-1.3-.1-2.5.3-3.7z"
        fill={lit ? "#FFD24A" : "#6B6590"}
      />
    </svg>
  );
}

export function BoltIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "h-5 w-5"}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "h-5 w-5"}>
      <path
        d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"
        fill="currentColor"
      />
    </svg>
  );
}

export function HeartIcon({ className, full = true }: IconProps & { full?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "h-6 w-6"}>
      <path
        d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
        fill={full ? "#FF6B81" : "none"}
        stroke={full ? "#FF6B81" : "#4A4468"}
        strokeWidth="2"
      />
    </svg>
  );
}

/** An arrow pointing right, rotated for the other directions. */
export function ArrowIcon({
  direction = "right",
  className,
}: IconProps & { direction?: "left" | "right" | "up" | "down" }) {
  const rotate = { right: "", left: "rotate-180", down: "rotate-90", up: "-rotate-90" }[direction];
  return (
    <Line className={`${className ?? "h-4 w-4"} ${rotate}`}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </Line>
  );
}

export function ChevronIcon({
  direction = "right",
  className,
}: IconProps & { direction?: "left" | "right" }) {
  return (
    <Line className={className}>
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </Line>
  );
}

export function FlipIcon({ className }: IconProps) {
  return (
    <Line className={className ?? "h-4 w-4"}>
      <path d="M4 10a8 8 0 0 1 14.3-4.3L20 7.5" />
      <path d="M20 3.5v4h-4" />
      <path d="M20 14a8 8 0 0 1-14.3 4.3L4 16.5" />
      <path d="M4 20.5v-4h4" />
    </Line>
  );
}

export function TrophyIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      <path d="M8 6H5a3 3 0 0 0 3 4" />
      <path d="M16 6h3a3 3 0 0 1-3 4" />
      <path d="M12 13v4" />
      <path d="M8 20h8" />
      <path d="M10 17h4" />
    </Line>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "h-5 w-5"}>
      <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
    </svg>
  );
}

export function ShuffleIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
    </Line>
  );
}

export function SwapIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M7 7h12l-3-3" />
      <path d="M17 17H5l3 3" />
    </Line>
  );
}

export function UndoIcon({ className }: IconProps) {
  return (
    <Line className={className ?? "h-4 w-4"}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Line>
  );
}

export function SkipIcon({ className }: IconProps) {
  return (
    <Line className={className ?? "h-4 w-4"}>
      <path d="M5 5l9 7-9 7z" />
      <path d="M19 5v14" />
    </Line>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Line>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v10h13V10" />
    </Line>
  );
}

export function HelpIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" />
      <path d="M12 17h.01" />
    </Line>
  );
}

export function SoundIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
    </Line>
  );
}

export function MuteIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5" />
      <path d="M21 9.5l-5 5" />
    </Line>
  );
}

export function SignOutIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h10" />
    </Line>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </Line>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Line className={className ?? "h-4 w-4"}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Line>
  );
}

export function MinusIcon({ className }: IconProps) {
  return (
    <Line className={className ?? "h-4 w-4"}>
      <path d="M5 12h14" />
    </Line>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Line className={className ?? "h-4 w-4"}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Line>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Line className={className ?? "h-4 w-4"}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Line>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "h-5 w-5"}>
      <circle cx="12" cy="5" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="19" r="1.8" fill="currentColor" />
    </svg>
  );
}

/** The app mark: a gold card with a bolt, as on the home-screen icon. */
export function LogoMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className ?? "h-7 w-7"}>
      <rect x="6" y="3" width="20" height="26" rx="5" fill="#FFD24A" transform="rotate(-8 16 16)" />
      <path d="M17.5 8 10.5 18h5l-1 6 7-10h-5l1-6z" fill="#16122B" />
    </svg>
  );
}

/** Word of the Day: a sun, for one new word each morning. */
export function SunIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </Line>
  );
}

const MEDAL_COLORS = {
  bronze: { face: "#D99A62", rim: "#9C5B2A", ribbon: "#B4532A" },
  silver: { face: "#DCE3F0", rim: "#8E9AB3", ribbon: "#5B6FA0" },
  gold: { face: "#FFD24A", rim: "#C28A00", ribbon: "#E0483E" },
  locked: { face: "#3A3458", rim: "#2F2A4A", ribbon: "#2F2A4A" },
} as const;

/** A medal for a collection rank. Filled, like the other game pieces. */
export function MedalIcon({
  className,
  tier,
}: IconProps & { tier: keyof typeof MEDAL_COLORS }) {
  const color = MEDAL_COLORS[tier];
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "h-6 w-6"}>
      <path d="M7 2h4l2.2 6.5-3.6 1.6L7 2z" fill={color.ribbon} />
      <path d="M17 2h-4l-2.2 6.5 3.6 1.6L17 2z" fill={color.ribbon} opacity="0.8" />
      <circle cx="12" cy="15" r="7" fill={color.rim} />
      <circle cx="12" cy="15" r="5.3" fill={color.face} />
      <path
        d="M12 11.6l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3 1-2.1z"
        fill={color.rim}
        opacity="0.55"
      />
    </svg>
  );
}

/** A screen with a play button, for watching videos. */
export function VideoIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="3.5" />
      <path d="M10 9.2v5.6l4.8-2.8L10 9.2z" />
    </Line>
  );
}

/** A speaker, for hearing a word said. */
export function SpeakIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </Line>
  );
}

/** A bell, for reminders. */
export function BellIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </Line>
  );
}

/** A grid of cards, for the collection album. */
export function AlbumIcon({ className }: IconProps) {
  return (
    <Line className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </Line>
  );
}
