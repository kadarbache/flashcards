"use client";

import { useOptimistic, useTransition } from "react";

import { updateDailyGoal } from "@/app/actions";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { MAX_DAILY_GOAL, MIN_DAILY_GOAL } from "@/lib/game";

const STEP = 5;

/** − 20 + under the goal ring. Saves straight away; the number moves at once. */
export function GoalStepper({ goal }: { goal: number }) {
  const [shown, setShown] = useOptimistic(goal);
  const [, startTransition] = useTransition();

  function change(delta: number) {
    const next = Math.max(MIN_DAILY_GOAL, Math.min(MAX_DAILY_GOAL, shown + delta));
    if (next === shown) return;
    startTransition(async () => {
      setShown(next);
      await updateDailyGoal(next);
    });
  }

  const button =
    "inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-high text-ink transition hover:bg-border-subtle active:scale-95 disabled:opacity-35";

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Daily goal">
      <button
        type="button"
        className={button}
        onClick={() => change(-STEP)}
        disabled={shown <= MIN_DAILY_GOAL}
        aria-label="Lower the daily goal"
      >
        <MinusIcon />
      </button>
      <span className="min-w-16 text-center text-sm font-bold text-ink-muted tabular-nums">
        {shown} a day
      </span>
      <button
        type="button"
        className={button}
        onClick={() => change(STEP)}
        disabled={shown >= MAX_DAILY_GOAL}
        aria-label="Raise the daily goal"
      >
        <PlusIcon />
      </button>
    </div>
  );
}
