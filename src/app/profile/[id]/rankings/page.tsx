import { History, Trophy } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunDatesButton } from "@/components/run-dates-button";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CompatibilityMeter } from "@/components/ui/score";
import { getProfile, getRankings } from "@/lib/queries";
import { cn, formatDate } from "@/lib/utils";

const MEDALS = [
  "bg-amber-100 text-amber-700 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  "bg-zinc-100 text-zinc-600 ring-zinc-300 dark:bg-zinc-700/40 dark:text-zinc-300 dark:ring-zinc-600",
  "bg-orange-100 text-orange-700 ring-orange-300 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30",
];

export default async function RankingsPage(props: PageProps<"/profile/[id]/rankings">) {
  const { id } = await props.params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const rankings = await getRankings(id);

  return (
    <div>
      <PageHeader
        backHref={`/profile/${id}`}
        backLabel={profile.name}
        title={`Best matches for ${profile.name}`}
        subtitle={
          rankings.length > 0
            ? `Ranked ${formatDate(rankings[0].created_at)} · score = both date ratings + 10 if both want a second date`
            : undefined
        }
        actions={
          <>
            <ButtonLink href={`/profile/${id}/dates`} variant="secondary">
              <History className="size-4" />
              Dates
            </ButtonLink>
            {rankings.length > 0 && <RunDatesButton personId={id} label="Re-rank" />}
          </>
        }
      />

      {rankings.length === 0 ? (
        <EmptyState icon={<Trophy className="size-10" />} title="No rankings yet">
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Run dates to simulate a first date with every other profile and rank them.
          </p>
          <RunDatesButton personId={id} />
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {rankings.map((r) => (
            <li
              key={r.rank}
              className="flex gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/60"
            >
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums ring-1",
                  MEDALS[r.rank - 1] ??
                    "bg-white text-zinc-500 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700"
                )}
              >
                #{r.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  {r.candidate ? (
                    <Link
                      href={`/profile/${r.candidate.id}`}
                      className="truncate font-semibold text-zinc-900 hover:text-rose-600 dark:text-zinc-100 dark:hover:text-rose-400"
                    >
                      {r.candidate.name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-zinc-400">Deleted profile</span>
                  )}
                  <div className="sm:w-56">
                    <CompatibilityMeter score={r.compatibility_score} />
                  </div>
                </div>
                {r.reasoning && (
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{r.reasoning}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
