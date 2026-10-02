import { Trophy, Wine } from "lucide-react";
import { notFound } from "next/navigation";
import { DateList, type DateItem } from "@/components/date-list";
import { RunDatesButton } from "@/components/run-dates-button";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getDates, getProfile } from "@/lib/queries";

export default async function DatesPage(props: PageProps<"/profile/[id]/dates">) {
  const { id } = await props.params;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const dates = await getDates(id);

  // Present every date from this person's side, whichever slot they were in.
  const items: DateItem[] = dates.map((d) => {
    const me = d.person_a_id === id ? "a" : "b";
    const other = me === "a" ? d.person_b : d.person_a;
    return {
      id: d.id,
      me,
      myName: profile.name,
      otherName: other?.name ?? "Deleted profile",
      venue: d.venue,
      shared_interest: d.shared_interest,
      transcript: d.transcript,
      my:
        me === "a"
          ? { score: d.score_a, reason: d.reason_a, second_date: d.second_date_a }
          : { score: d.score_b, reason: d.reason_b, second_date: d.second_date_b },
      their:
        me === "a"
          ? { score: d.score_b, reason: d.reason_b, second_date: d.second_date_b }
          : { score: d.score_a, reason: d.reason_a, second_date: d.second_date_a },
      created_at: d.created_at,
    };
  });

  return (
    <div>
      <PageHeader
        backHref={`/profile/${id}`}
        backLabel={profile.name}
        title={`${profile.name}'s dates`}
        subtitle={dates.length > 0 ? `${dates.length} simulated first date${dates.length === 1 ? "" : "s"} · tap one to read it` : undefined}
        actions={
          dates.length > 0 && (
            <ButtonLink href={`/profile/${id}/rankings`} variant="secondary">
              <Trophy className="size-4" />
              Rankings
            </ButtonLink>
          )
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={<Wine className="size-10" />} title="No dates yet">
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Run dates to simulate a first date with every other profile.
          </p>
          <RunDatesButton personId={id} />
        </EmptyState>
      ) : (
        <DateList dates={items} />
      )}
    </div>
  );
}
