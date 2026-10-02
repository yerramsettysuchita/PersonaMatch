"use client";

import { AlertTriangle, AtSign, Briefcase, CheckCircle2, ClipboardPaste, Loader2, Sparkles, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Platform = "linkedin" | "instagram";
type SourceStatus = { status: "scraped" | "pasted" | "failed"; error?: string };

const PLATFORMS: Record<Platform, { label: string; icon: typeof Briefcase; placeholder: string; pastePlaceholder: string }> = {
  linkedin: {
    label: "LinkedIn",
    icon: Briefcase,
    placeholder: "https://www.linkedin.com/in/username",
    pastePlaceholder: "Paste their headline, About section, experience, skills…",
  },
  instagram: {
    label: "Instagram",
    icon: AtSign,
    placeholder: "https://www.instagram.com/username",
    pastePlaceholder: "Paste their bio and a few recent captions, one per paragraph…",
  },
};

const inputClasses =
  "w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600";

function progressMessage(seconds: number) {
  if (seconds < 4) return "Starting…";
  if (seconds < 45) return "Scraping LinkedIn and Instagram…";
  return "Building the persona with Gemini…";
}

export function IngestForm() {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<Platform, string>>({ linkedin: "", instagram: "" });
  const [texts, setTexts] = useState<Record<Platform, string>>({ linkedin: "", instagram: "" });
  const [name, setName] = useState("");
  const [manual, setManual] = useState<Platform[]>([]);
  const [sources, setSources] = useState<Partial<Record<Platform, SourceStatus>>>({});
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  const busy = startedAt !== null;

  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const toggleManual = (p: Platform) =>
    setManual((m) => (m.includes(p) ? m.filter((x) => x !== p) : [...m, p]));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    for (const p of ["linkedin", "instagram"] as const) {
      const hasText = manual.includes(p) && texts[p].trim().length >= 20;
      if (!urls[p].trim() && !hasText) {
        setError(`Add a ${PLATFORMS[p].label} URL${manual.includes(p) ? " or paste at least a couple of sentences" : ""}.`);
        return;
      }
    }

    setSeconds(0);
    setStartedAt(Date.now());
    try {
      const body: Record<string, string> = {};
      if (name.trim()) body.name = name.trim();
      for (const p of ["linkedin", "instagram"] as const) {
        if (urls[p].trim()) body[`${p}_url`] = urls[p].trim();
        if (manual.includes(p) && texts[p].trim()) body[`${p}_text`] = texts[p].trim();
      }

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data.sources) setSources(data.sources);

      if (res.ok && data.profile?.id) {
        router.push(`/profile/${data.profile.id}`);
        return; // keep the busy state until navigation completes
      }
      if (res.status === 422 && Array.isArray(data.needs_manual)) {
        setManual((m) => [...new Set([...m, ...(data.needs_manual as Platform[])])]);
      }
      setError(data.error ?? `Something went wrong (HTTP ${res.status}).`);
    } catch {
      setError("Couldn't reach the server. Is `npm run dev` still running?");
    }
    setStartedAt(null);
  }

  return (
    <Card className="p-6 sm:p-8">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {(["linkedin", "instagram"] as const).map((p) => {
          const { label, icon: Icon, placeholder, pastePlaceholder } = PLATFORMS[p];
          const src = sources[p];
          const showPaste = manual.includes(p);
          return (
            <div key={p} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${p}-url`} className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  <Icon className="size-4 text-zinc-400" />
                  {label}
                  {src?.status === "scraped" && <CheckCircle2 className="size-4 text-emerald-500" aria-label="scraped" />}
                  {src?.status === "failed" && <XCircle className="size-4 text-rose-500" aria-label="scrape failed" />}
                </label>
                <button
                  type="button"
                  onClick={() => toggleManual(p)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400"
                >
                  <ClipboardPaste className="size-3.5" />
                  {showPaste ? "Hide pasted text" : "Paste text instead"}
                </button>
              </div>
              <input
                id={`${p}-url`}
                type="text"
                inputMode="url"
                autoComplete="off"
                placeholder={placeholder}
                value={urls[p]}
                onChange={(e) => setUrls((u) => ({ ...u, [p]: e.target.value }))}
                disabled={busy}
                className={inputClasses}
              />
              {src?.status === "failed" && (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  Scraping failed: {src.error}. Paste their profile text below instead.
                </p>
              )}
              {showPaste && (
                <textarea
                  aria-label={`${label} profile text`}
                  rows={5}
                  placeholder={pastePlaceholder}
                  value={texts[p]}
                  onChange={(e) => setTexts((t) => ({ ...t, [p]: e.target.value }))}
                  disabled={busy}
                  className={cn(inputClasses, "resize-y")}
                />
              )}
            </div>
          );
        })}

        {manual.length > 0 && (
          <div className="flex flex-col gap-2">
            <label htmlFor="name" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Name <span className="font-normal text-zinc-400">(needed if both are pasted)</span>
            </label>
            <input
              id="name"
              type="text"
              placeholder="Their name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className={inputClasses}
            />
          </div>
        )}

        {error && (
          <div role="alert" className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" disabled={busy} className="py-3 text-base">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {progressMessage(seconds)} <span className="tabular-nums opacity-70">{seconds}s</span>
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Find Match
            </>
          )}
        </Button>
        {busy && (
          <p className="-mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
            This usually takes about a minute.
          </p>
        )}
      </form>
    </Card>
  );
}
