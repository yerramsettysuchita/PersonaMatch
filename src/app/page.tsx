import { ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import { IngestForm } from "@/components/ingest-form";
import { listProfiles } from "@/lib/queries";
import { formatDate } from "@/lib/utils";

// Recent profiles come from the database, so render on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const profiles = await listProfiles(12);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-10">
      <section className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          Find someone&apos;s best match
        </h1>
        <p className="mx-auto mt-3 max-w-md text-zinc-500 dark:text-zinc-400">
          We read their public LinkedIn and Instagram, build a persona, simulate first dates with everyone else, and rank
          who clicks.
        </p>
      </section>

      <IngestForm />

      {profiles.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Users className="size-4 text-rose-500" />
            Recent profiles
          </h2>
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60">
            {profiles.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/profile/${p.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
                    {p.is_sample && (
                      <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                        Sample
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-400">
                    {formatDate(p.created_at)}
                    <ChevronRight className="size-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
