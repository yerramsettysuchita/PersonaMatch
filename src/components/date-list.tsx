"use client";

import { ChevronDown, MapPin, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChatTranscript, type Turn } from "@/components/ui/chat-transcript";
import { ScorePill, SecondDate } from "@/components/ui/score";
import { cn, formatDate } from "@/lib/utils";

export type DateItem = {
  id: string;
  me: "a" | "b";
  myName: string;
  otherName: string;
  venue: string | null;
  shared_interest: string | null;
  transcript: Turn[];
  my: { score: number | null; reason: string | null; second_date: boolean | null };
  their: { score: number | null; reason: string | null; second_date: boolean | null };
  created_at: string;
};

export function DateList({ dates }: { dates: DateItem[] }) {
  const [open, setOpen] = useState<string | null>(dates[0]?.id ?? null);

  return (
    <ul className="flex flex-col gap-3">
      {dates.map((d) => {
        const isOpen = open === d.id;
        const mutual = !!d.my.second_date && !!d.their.second_date;
        const names = d.me === "a" ? { a: d.myName, b: d.otherName } : { a: d.otherName, b: d.myName };
        return (
          <li
            key={d.id}
            className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : d.id)}
              aria-expanded={isOpen}
              className="flex w-full items-start gap-3 p-4 text-left hover:bg-zinc-50 sm:items-center sm:p-5 dark:hover:bg-zinc-900"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{d.otherName}</span>
                  {mutual && (
                    <Badge tone="rose">
                      <Sparkles className="size-3" /> Mutual match
                    </Badge>
                  )}
                </div>
                {d.venue && (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" />
                    <span className="line-clamp-2">{d.venue}</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex items-center gap-1.5">
                  <ScorePill score={d.my.score} label={firstName(d.myName)} />
                  <SecondDate yes={d.my.second_date} name={d.myName} />
                </div>
                <div className="flex items-center gap-1.5">
                  <ScorePill score={d.their.score} label={firstName(d.otherName)} />
                  <SecondDate yes={d.their.second_date} name={d.otherName} />
                </div>
              </div>
              <ChevronDown
                className={cn("mt-1 size-5 shrink-0 text-zinc-400 transition-transform sm:mt-0", isOpen && "rotate-180")}
              />
            </button>

            {isOpen && (
              <div className="border-t border-zinc-100 px-4 pt-4 pb-5 sm:px-5 dark:border-zinc-800">
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {d.shared_interest && <Badge tone="violet">Bonded over: {d.shared_interest}</Badge>}
                  <span>{formatDate(d.created_at)}</span>
                </div>

                <div className="rounded-2xl bg-zinc-50 p-3 sm:p-4 dark:bg-zinc-950/60">
                  <ChatTranscript turns={d.transcript} me={d.me} names={names} />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Verdict name={d.myName} {...d.my} />
                  <Verdict name={d.otherName} {...d.their} />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Verdict({
  name,
  score,
  reason,
  second_date,
}: {
  name: string;
  score: number | null;
  reason: string | null;
  second_date: boolean | null;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}&apos;s verdict</span>
        <div className="flex items-center gap-1.5">
          <ScorePill score={score} />
          <SecondDate yes={second_date} name={name} />
        </div>
      </div>
      {reason && <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{reason}</p>}
      <p className="mt-2 text-xs font-medium text-zinc-500">
        {second_date ? "Wants a second date" : "No second date"}
      </p>
    </div>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0];
