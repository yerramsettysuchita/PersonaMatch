import {
  AtSign,
  Briefcase,
  ExternalLink,
  FileSearch,
  Gem,
  HeartHandshake,
  History,
  Lightbulb,
  MessageCircle,
  Mountain,
  ShieldOff,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RunDatesButton } from "@/components/run-dates-button";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { Category, Evidence } from "@/lib/llm";
import { countDates, getProfile, getRankings, type Profile } from "@/lib/queries";

const CATEGORIES: { key: Exclude<Category, "communication_style">; label: string; tone: Tone; icon: ReactNode }[] = [
  { key: "needs", label: "Needs", tone: "rose", icon: <HeartHandshake className="size-4" /> },
  { key: "hobbies", label: "Hobbies", tone: "sky", icon: <Mountain className="size-4" /> },
  { key: "interests", label: "Interests", tone: "violet", icon: <Lightbulb className="size-4" /> },
  { key: "values", label: "Values", tone: "amber", icon: <Gem className="size-4" /> },
];

const CATEGORY_LABEL: Record<Category, string> = {
  needs: "Need",
  hobbies: "Hobby",
  interests: "Interest",
  values: "Value",
  communication_style: "Style",
};

export default async function ProfilePage(props: PageProps<"/profile/[id]">) {
  const { id } = await props.params;
  const profile = await getProfile(id);
  if (!profile) notFound();

  const [dateCount, rankings] = await Promise.all([countDates(id), getRankings(id)]);

  return (
    <div>
      <PageHeader
        backHref="/"
        backLabel="All profiles"
        title={profile.name}
        subtitle={<SourceLinks profile={profile} />}
        actions={
          <>
            <ButtonLink href={`/profile/${id}/dates`} variant="secondary">
              <History className="size-4" />
              View Past Dates{dateCount > 0 && ` (${dateCount})`}
            </ButtonLink>
            {profile.opted_in && <RunDatesButton personId={id} />}
          </>
        }
      />

      {!profile.opted_in && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          <ShieldOff className="mt-0.5 size-4 shrink-0" />
          <span>
            Not in the dating pool: this person hasn&apos;t opted in, so they won&apos;t be dated or ranked.
          </span>
        </div>
      )}

      {rankings.length > 0 && (
        <Link
          href={`/profile/${id}/rankings`}
          className="mb-6 flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/15"
        >
          <Trophy className="size-4 shrink-0" />
          <span>
            Top match: <strong>{rankings[0].candidate?.name ?? "Unknown"}</strong> · view all {rankings.length} rankings
          </span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {CATEGORIES.map(({ key, label, tone, icon }) => (
          <Card key={key}>
            <SectionTitle icon={icon}>{label}</SectionTitle>
            {profile[key].length ? (
              <div className="flex flex-wrap gap-2">
                {profile[key].map((item) => (
                  <Badge key={item} tone={tone}>
                    {item}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Nothing found in their profiles.</p>
            )}
          </Card>
        ))}
      </div>

      <PreferencesCard profile={profile} />

      {profile.communication_style && (
        <Card className="mt-4">
          <SectionTitle icon={<MessageCircle className="size-4" />}>Communication style</SectionTitle>
          <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">{profile.communication_style}</p>
        </Card>
      )}

      <Card className="mt-4 p-0 sm:p-0">
        <div className="p-5 pb-2">
          <SectionTitle icon={<FileSearch className="size-4" />} className="mb-1">
            Evidence
          </SectionTitle>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Where each claim above comes from.</p>
        </div>
        <EvidenceList evidence={profile.evidence} profile={profile} />
      </Card>
    </div>
  );
}

function SourceLinks({ profile }: { profile: Profile }) {
  const links = [
    { href: profile.linkedin_url, label: "LinkedIn", icon: Briefcase, pasted: profile.raw_linkedin_data?.source === "manual" },
    { href: profile.instagram_url, label: "Instagram", icon: AtSign, pasted: profile.raw_instagram_data?.source === "manual" },
  ];
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map(({ href, label, icon: Icon, pasted }) =>
        href ? (
          <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-rose-600">
            <Icon className="size-3.5" />
            {label}
            {pasted && <span className="text-zinc-400">(pasted)</span>}
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <span key={label} className="inline-flex items-center gap-1.5">
            <Icon className="size-3.5" />
            {label} {pasted ? "(pasted text)" : "(none)"}
          </span>
        )
      )}
    </span>
  );
}

// Links an evidence section ("instagram:post#3") to the post or profile it came from.
function sourceHref(profile: Profile, section: string): string | null {
  const [platform, part] = section.split(":");
  if (platform === "instagram") {
    const post = part?.match(/^post#(\d+)$/);
    const ig = profile.raw_instagram_data;
    if (post && ig?.source === "apify") return ig.posts[Number(post[1]) - 1]?.url ?? profile.instagram_url;
    return profile.instagram_url;
  }
  return platform === "linkedin" ? profile.linkedin_url : null;
}

function EvidenceList({ evidence, profile }: { evidence: Evidence[]; profile: Profile }) {
  if (!evidence.length) return <p className="px-5 pb-5 text-sm text-zinc-400">No evidence recorded.</p>;
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {evidence.map((e, i) => {
        const href = sourceHref(profile, e.section);
        const sectionLabel = e.section.replace(":", " · ").replace("#", " #");
        return (
          <li key={i} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex shrink-0 items-center gap-2 sm:w-48">
              <span className="w-16 shrink-0 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                {CATEGORY_LABEL[e.category]}
              </span>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {e.category === "communication_style" ? "Tone & style" : e.claim}
              </span>
            </div>
            <blockquote className="flex-1 border-l-2 border-zinc-200 pl-3 text-sm text-zinc-600 italic dark:border-zinc-700 dark:text-zinc-400">
              “{e.quote}”
              {!e.quote_verified && (
                <span className="ml-2 text-[11px] text-amber-600 not-italic dark:text-amber-400">paraphrased</span>
              )}
            </blockquote>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-zinc-500 hover:text-rose-600 dark:text-zinc-400"
              >
                {sectionLabel}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="shrink-0 text-xs text-zinc-500">{sectionLabel}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const LOOKING_FOR_LABEL: Record<string, string> = {
  "long-term": "Long-term relationship",
  "short-term": "Something short-term",
  "friendship-first": "Friendship first",
  open: "Open to anything",
};

// Self-declared at ingest; shown so it's clear these were asked, not inferred.
function PreferencesCard({ profile }: { profile: Profile }) {
  const { looking_for, age, age_range_min: min, age_range_max: max, city } = profile;
  const items = [
    looking_for && { label: "Looking for", value: LOOKING_FOR_LABEL[looking_for] ?? looking_for },
    age !== null && { label: "Age", value: String(age) },
    (min !== null || max !== null) && { label: "Partner age", value: `${min ?? 18}–${max ?? "any"}` },
    city && { label: "City", value: city },
  ].filter((x): x is { label: string; value: string } => !!x);

  return (
    <Card className="mt-4">
      <SectionTitle icon={<SlidersHorizontal className="size-4" />}>Declared preferences</SectionTitle>
      {items.length ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {items.map((i) => (
            <div key={i.label}>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">{i.label}</dt>
              <dd className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">{i.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-zinc-400">None declared, so open to anyone in the pool.</p>
      )}
    </Card>
  );
}
