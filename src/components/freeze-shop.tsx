"use client";

import { useState, useTransition } from "react";

import { buyStreakFreeze } from "@/app/actions";
import { play } from "@/components/game/sound";
import { SnowflakeIcon } from "@/components/icons";
import { cannotBuy, FREEZE_COST, MAX_FREEZES } from "@/lib/streak-freeze";

const price = `${FREEZE_COST.toLocaleString("en-US")} XP`;

/**
 * The streak freezes held, and buying another with XP. Lives in the streak
 * card on the home screen. Buying asks once more first: it is a lot of XP to
 * lose to a stray tap.
 */
export function FreezeShop({ held, xpToSpend }: { held: number; xpToSpend: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const full = held >= MAX_FREEZES;
  const short = !full && cannotBuy(held, xpToSpend) !== null;

  function buy() {
    startTransition(async () => {
      const outcome = await buyStreakFreeze();
      setConfirming(false);
      if (outcome.ok) {
        setError(null);
        play("level");
      } else {
        setError(outcome.message);
        play("wrong");
      }
    });
  }

  const button =
    "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-extrabold transition active:scale-[0.97] disabled:opacity-50";

  return (
    <div className="space-y-3 rounded-2xl bg-[#3d2618] p-3">
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 gap-1.5" aria-hidden="true">
          {Array.from({ length: MAX_FREEZES }, (_, slot) => (
            <span
              key={slot}
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                slot < held
                  ? "bg-ice text-ice-ink shadow-[0_0_18px_-4px_var(--color-ice)]"
                  : "border-2 border-dashed border-[#5c3c27] text-[#6e4c36]"
              }`}
            >
              <SnowflakeIcon className="h-5 w-5" />
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <p className="font-extrabold">
            {held === 0
              ? "No streak freeze"
              : `${held} streak ${held === 1 ? "freeze" : "freezes"} ready`}
          </p>
          <p className="text-xs text-[#d9b394]">
            {full
              ? `Covers a missed day. ${MAX_FREEZES} is the most you can hold.`
              : "Covers a day you miss, so the streak lives on."}
          </p>
        </div>
      </div>

      {!full &&
        (confirming ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={buy}
              disabled={pending}
              className={`${button} bg-ice text-ice-ink`}
            >
              <SnowflakeIcon className="h-4 w-4" />
              {pending ? "Buying…" : `Spend ${price}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={`${button} flex-none bg-[#4d3020] text-[#f2c9a8] hover:bg-[#5a3826]`}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              play("tap");
              setError(null);
              setConfirming(true);
            }}
            disabled={short}
            className={`${button} w-full bg-[#4d3020] text-ice hover:bg-[#5a3826]`}
          >
            <SnowflakeIcon className="h-4 w-4" />
            Buy a freeze · {price}
          </button>
        ))}

      {short && (
        <p className="text-xs text-[#d9b394] tabular-nums">
          You have {xpToSpend.toLocaleString("en-US")} XP to spend.{" "}
          {(FREEZE_COST - xpToSpend).toLocaleString("en-US")} more to go.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs font-bold text-again">
          {error}
        </p>
      )}
    </div>
  );
}
