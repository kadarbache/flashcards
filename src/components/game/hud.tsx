import { BoltIcon, FlameIcon } from "@/components/icons";

/** Days in a row. Grey until today's goal is met, so it reads as "still to do". */
export function StreakPill({ streak, lit }: { streak: number; lit: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-surface-raised py-2 pr-3.5 pl-2.5 text-base font-extrabold tabular-nums"
      title={`${streak} day streak${lit ? "" : ", today still to do"}`}
    >
      <FlameIcon className="h-5 w-5" lit={lit} />
      <span>{streak}</span>
      <span className="sr-only">day streak</span>
    </span>
  );
}

export function LevelBar({
  level,
  into,
  needed,
}: {
  level: number;
  into: number;
  needed: number;
}) {
  const pct = Math.min(100, (into / needed) * 100);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" title={`${into} / ${needed} XP`}>
      <span className="shrink-0 rounded-lg bg-gold px-2 py-1 text-xs font-extrabold whitespace-nowrap text-paper-ink">
        Lv {level}
      </span>
      <div
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-border-subtle"
        role="progressbar"
        aria-label={`Level ${level} progress`}
        aria-valuemin={0}
        aria-valuemax={needed}
        aria-valuenow={into}
      >
        <div
          className="h-full rounded-full bg-gold transition-[width] duration-500 ease-[cubic-bezier(.2,1.2,.4,1)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function MultiplierPill({ multiplier, pulseKey }: { multiplier: number; pulseKey: number }) {
  const hot = multiplier > 1;
  return (
    <span
      key={pulseKey}
      className={`flex items-center gap-1 rounded-full px-3 py-2 text-[15px] font-extrabold tabular-nums transition-colors ${
        hot ? "anim-pulse bg-gold text-paper-ink" : "bg-surface-raised text-ink-muted"
      }`}
      title="XP multiplier"
    >
      <BoltIcon className="h-4 w-4" />x{multiplier}
    </span>
  );
}

/** A progress ring with the number in the middle. */
export function GoalRing({
  value,
  goal,
  size = 88,
  stroke = 10,
  children,
}: {
  value: number;
  goal: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const done = Math.min(1, value / goal);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#2F2A4A" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={done >= 1 ? "#FFD24A" : "#3EE0A1"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - done)}
          className="transition-[stroke-dashoffset] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
