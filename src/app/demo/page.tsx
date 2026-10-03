import type { Metadata } from "next";
import { History, MapPin, Trophy, User } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listDemoPeople, type DemoPerson } from "@/lib/queries";

export const metadata: Metadata = { title: "Demo · PersonaMatch" };

// Lists live database contents, so render on every request.
export const dynamic = "force-dynamic";

const linkClasses =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

export default async function DemoPage() {
  const people = await listDemoPeople();
  const real = people.filter((p) => !p.is_sample);
  const samples = people.filter((p) => p.is_sample);
  const inPool = real.filter((p) => p.opted_in).length;

  return (
    <div>
      <PageHeader
        title="Demo: everyone in the pool"
        subtitle={`${inPool} consenting real ${inPool === 1 ? "person" : "people"} in the pool${samples.length ? ` · ${samples.length} fictional sample profiles in a separate pool` : ""} · browse personas, simulated dates and rankings without typing anything`}
      />

      {people.length === 0 && <EmptyState icon={<User className="size-10" />} title="No profiles yet" />}

      {real.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Real people ({real.length})</h2>
          <PeopleGrid people={real} />
        </section>
      )}

      {samples.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Fictional sample profiles ({samples.length})
          </h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Made-up people used to exercise the pipeline. They only date each other and are excluded from the evaluation.
          </p>
          <PeopleGrid people={samples} />
        </section>
      )}
    </div>
  );
}

function PeopleGrid({ people }: { people: DemoPerson[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {people.map((p) => (
        <li
          key={p.id}
          className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/profile/${p.id}`}
                className="font-semibold text-zinc-900 hover:text-rose-600 dark:text-zinc-100 dark:hover:text-rose-400"
              >
                {p.name}
              </Link>
              {p.city && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <MapPin className="size-3" />
                  {p.city}
                </p>
              )}
            </div>
            {p.is_sample ? (
              <Badge tone="violet">Fictional sample</Badge>
            ) : p.opted_in ? (
              <Badge tone="emerald">In pool</Badge>
            ) : (
              <Badge tone="zinc">Not opted in</Badge>
            )}
          </div>

          {p.hobbies.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.hobbies.slice(0, 4).map((h) => (
                <Badge key={h} tone="sky">
                  {h}
                </Badge>
              ))}
            </div>
          )}

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {p.dates} date{p.dates === 1 ? "" : "s"}
            {p.topMatch && (
              <>
                {" "}
                · top match: <span className="font-medium text-zinc-700 dark:text-zinc-300">{p.topMatch}</span>
              </>
            )}
          </p>

          <div className="-mx-1 mt-auto flex flex-wrap gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <Link href={`/profile/${p.id}`} className={linkClasses}>
              <User className="size-3.5" /> Profile
            </Link>
            <Link href={`/profile/${p.id}/dates`} className={linkClasses}>
              <History className="size-3.5" /> Dates
            </Link>
            <Link href={`/profile/${p.id}/rankings`} className={linkClasses}>
              <Trophy className="size-3.5" /> Rankings{p.ranked > 0 && ` (${p.ranked})`}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
