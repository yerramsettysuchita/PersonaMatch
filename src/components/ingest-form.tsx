"use client";

import {
  AlertTriangle,
  AtSign,
  Briefcase,
  CheckCircle2,
  ClipboardPaste,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Platform = "linkedin" | "instagram";
type Prefs = { looking_for: string; age: string; age_range_min: string; age_range_max: string; city: string };

const LOOKING_FOR_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "long-term", label: "Long-term relationship" },
  { value: "short-term", label: "Something short-term" },
  { value: "friendship-first", label: "Friendship first" },
  { value: "open", label: "Open to anything" },
];
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
  const [consent, setConsent] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({ looking_for: "", age: "", age_range_min: "", age_range_max: "", city: "" });
  const setPref = (key: keyof Prefs, value: string) => setPrefs((p) => ({ ...p, [key]: value }));
  const [manual, setManual] = useState<Platform[]>([]);
  const [sources, setSources] = useState<Partial<Record<Platform, SourceStatus>>>({});
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ linkedin_name: string; instagram_name: string } | null>(null);
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
    await submit(false);
  }

  async function submit(confirmIdentity: boolean) {
    setError(null);
    setIdentity(null);

    if (!consent) {
      setError("This person must consent before we read their profiles. Tick the consent box to continue.");
      return;
    }

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
      const body: Record<string, string | number | boolean> = { opted_in: true };
      if (confirmIdentity) body.confirm_identity = true;
      if (sandbox) body.sandbox_opt_in = true;
      if (name.trim()) body.name = name.trim();
      if (prefs.looking_for) body.looking_for = prefs.looking_for;
      if (prefs.city.trim()) body.city = prefs.city.trim();
      for (const key of ["age", "age_range_min", "age_range_max"] as const) {
        if (prefs[key].trim()) body[key] = Number(prefs[key]);
      }
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
      if (res.status === 409 && data.identity_mismatch) {
        setIdentity(data.identity_mismatch);
      } else {
        setError(data.error ?? `Something went wrong (HTTP ${res.status}).`);
      }
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

        <fieldset className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="flex items-center gap-2 px-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <SlidersHorizontal className="size-4 text-zinc-400" />
            Their preferences <span className="font-normal text-zinc-400">(optional, asked, never guessed)</span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Looking for
              <select
                value={prefs.looking_for}
                onChange={(e) => setPref("looking_for", e.target.value)}
                disabled={busy}
                className={inputClasses}
              >
                {LOOKING_FOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              City
              <input
                type="text"
                placeholder="e.g. Hyderabad"
                value={prefs.city}
                onChange={(e) => setPref("city", e.target.value)}
                disabled={busy}
                className={inputClasses}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Their age
              <input
                type="number"
                min={18}
                max={120}
                placeholder="18+"
                value={prefs.age}
                onChange={(e) => setPref("age", e.target.value)}
                disabled={busy}
                className={inputClasses}
              />
            </label>
            <div className="flex flex-col gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Partner age range
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={18}
                  max={120}
                  aria-label="Minimum partner age"
                  placeholder="Min"
                  value={prefs.age_range_min}
                  onChange={(e) => setPref("age_range_min", e.target.value)}
                  disabled={busy}
                  className={inputClasses}
                />
                <span>–</span>
                <input
                  type="number"
                  min={18}
                  max={120}
                  aria-label="Maximum partner age"
                  placeholder="Max"
                  value={prefs.age_range_max}
                  onChange={(e) => setPref("age_range_max", e.target.value)}
                  disabled={busy}
                  className={inputClasses}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Matches must fit both people&apos;s preferences. Blank fields mean no restriction, but setting an age range only
            matches people who gave their age.
          </p>
        </fieldset>

        <label className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={busy}
            className="mt-0.5 size-4 shrink-0 accent-emerald-600"
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="size-4" />
              This person has agreed to be included
            </span>
            Required. I am this person, or they have agreed to have their public LinkedIn and Instagram read and to
            join the PersonaMatch dating pool. They are 18 or older and single.
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={sandbox}
            onChange={(e) => setSandbox(e.target.checked)}
            disabled={busy}
            className="mt-0.5 size-4 shrink-0 accent-violet-600"
          />
          <span>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">Sandbox (optional):</span> also go on dates
            with clearly labelled fictional sample profiles, so there are matches to explore while the real pool is
            small. Real and sample matches are always shown separately.
          </span>
        </label>

        {identity && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>These may not be the same person.</strong> LinkedIn says &ldquo;{identity.linkedin_name}&rdquo; but
                Instagram says &ldquo;{identity.instagram_name}&rdquo;. Check both links before continuing.
              </span>
            </span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => submit(true)} disabled={busy}>
                Yes, it&apos;s the same person, continue
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIdentity(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" disabled={busy || !consent} className="py-3 text-base">
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
