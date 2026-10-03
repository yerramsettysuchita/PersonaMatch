"use client";

import { AlertTriangle, Loader2, Wine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const MAX_ROUNDS = 6;

type RankResponse = {
  rankings?: unknown[];
  not_dated?: unknown[];
  failed?: unknown[];
  error?: string;
};

// Calls /api/rank (which simulates up to 10 missing dates per call) repeatedly
// until every eligible candidate is dated or MAX_ROUNDS pass, then opens the
// leaderboard. The leaderboard itself flags anything still missing.
export function RunDatesButton({ personId, label = "Run Dates" }: { personId: string; label?: string }) {
  const router = useRouter();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  async function run() {
    setError(null);
    setProgress(null);
    setSeconds(0);
    setStartedAt(Date.now());
    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const res = await fetch("/api/rank", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person_id: personId }),
        });
        const data: RankResponse = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? `Ranking failed (HTTP ${res.status}).`);
          setStartedAt(null);
          return;
        }
        const done = data.rankings?.length ?? 0;
        const remaining = (data.not_dated?.length ?? 0) + (data.failed?.length ?? 0);
        setProgress({ done, total: done + remaining });
        if (remaining === 0) break;
      }
      router.push(`/profile/${personId}/rankings`);
      router.refresh();
      return;
    } catch {
      setError("Couldn't reach the server.");
    }
    setStartedAt(null);
  }

  const busy = startedAt !== null;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button onClick={run} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Wine className="size-4" />}
        {busy ? (
          <>
            {progress ? `Dated ${progress.done} of ${progress.total} candidates` : "Simulating dates…"}{" "}
            <span className="tabular-nums opacity-70">{seconds}s</span>
          </>
        ) : (
          label
        )}
      </Button>
      {busy && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Two AI agents date each candidate (~15s each, 3 at a time).
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
          <AlertTriangle className="size-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}
