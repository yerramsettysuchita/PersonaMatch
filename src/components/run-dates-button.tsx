"use client";

import { AlertTriangle, Loader2, Wine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Calls /api/rank (which simulates any missing dates) and opens the leaderboard.
export function RunDatesButton({ personId, label = "Run Dates" }: { personId: string; label?: string }) {
  const router = useRouter();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  async function run() {
    setError(null);
    setSeconds(0);
    setStartedAt(Date.now());
    try {
      const res = await fetch("/api/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/profile/${personId}/rankings`);
        router.refresh();
        return;
      }
      setError(data.error ?? `Ranking failed (HTTP ${res.status}).`);
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
            Simulating dates… <span className="tabular-nums opacity-70">{seconds}s</span>
          </>
        ) : (
          label
        )}
      </Button>
      {busy && <p className="text-xs text-zinc-500 dark:text-zinc-400">New dates take ~20s each, 3 at a time.</p>}
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
          <AlertTriangle className="size-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}
