import { Heart, HeartOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Date score out of 10, colored by how the date went.
export function ScorePill({ score, label }: { score: number | null; label?: string }) {
  const s = score === null ? null : Number(score);
  const tone =
    s === null
      ? "text-zinc-500 bg-zinc-100 dark:bg-zinc-800"
      : s >= 7
        ? "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10"
        : s >= 5
          ? "text-amber-800 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/10"
          : "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-500/10";
  return (
    <span className={cn("inline-flex items-baseline gap-1 rounded-lg px-2 py-1 text-xs font-medium tabular-nums", tone)}>
      {label && <span className="font-normal opacity-80">{label}</span>}
      {s === null ? "–" : s}
      <span className="opacity-60">/10</span>
    </span>
  );
}

export function SecondDate({ yes, name }: { yes: boolean | null; name: string }) {
  return yes ? (
    <span title={`${name} wants a second date`} className="text-rose-500">
      <Heart className="size-4 fill-current" />
    </span>
  ) : (
    <span title={`${name} doesn't want a second date`} className="text-zinc-400 dark:text-zinc-600">
      <HeartOff className="size-4" />
    </span>
  );
}

// Horizontal meter for compatibility_score (0-30: score_a + score_b + 10 mutual bonus).
export function CompatibilityMeter({ score, max = 30 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (Number(score) / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-pink-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {Number(score)}
        <span className="text-xs font-normal text-zinc-400">/{max}</span>
      </span>
    </div>
  );
}
