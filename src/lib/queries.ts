// Server-side reads for the pages. Uses the service-role client, so only
// import this from Server Components.
import type { InstagramData, LinkedInData, PastedData } from "./apify";
import type { DateRow } from "./dates";
import type { Evidence } from "./llm";
import { pairBlockers, type Preferences } from "./matching";
import { supabaseAdmin } from "./supabase";
import { isUuid } from "./utils";

export type Profile = Omit<Preferences, "name"> & {
  id: string;
  name: string;
  linkedin_url: string | null;
  instagram_url: string | null;
  raw_linkedin_data: LinkedInData | PastedData | null;
  raw_instagram_data: InstagramData | PastedData | null;
  needs: string[];
  hobbies: string[];
  interests: string[];
  values: string[];
  communication_style: string | null;
  evidence: Evidence[];
  created_at: string;
};

export type ProfileSummary = Pick<Profile, "id" | "name" | "created_at">;

export type RankingRow = {
  rank: number;
  compatibility_score: number;
  reasoning: string | null;
  created_at: string;
  candidate: { id: string; name: string } | null;
};

export type DateWithPeople = DateRow & {
  person_a: { id: string; name: string } | null;
  person_b: { id: string; name: string } | null;
};

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function getProfile(id: string): Promise<Profile | null> {
  if (!isUuid(id)) return null;
  return check(await supabaseAdmin().from("profiles").select("*").eq("id", id).maybeSingle());
}

export async function listProfiles(limit = 20): Promise<ProfileSummary[]> {
  return check(
    await supabaseAdmin().from("profiles").select("id, name, created_at").order("created_at", { ascending: false }).limit(limit)
  );
}

export async function getRankings(personId: string): Promise<RankingRow[]> {
  return check(
    await supabaseAdmin()
      .from("rankings")
      .select("rank, compatibility_score, reasoning, created_at, candidate:profiles!rankings_candidate_id_fkey(id, name)")
      .eq("person_id", personId)
      .order("rank")
      .returns<RankingRow[]>()
  );
}

export async function getDates(personId: string): Promise<DateWithPeople[]> {
  return check(
    await supabaseAdmin()
      .from("dates")
      .select(
        "*, person_a:profiles!dates_person_a_id_fkey(id, name), person_b:profiles!dates_person_b_id_fkey(id, name)"
      )
      .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`)
      .order("created_at", { ascending: false })
      .returns<DateWithPeople[]>()
  );
}

export async function countDates(personId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("dates")
    .select("id", { count: "exact", head: true })
    .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type RankingCoverage = {
  eligible: number;
  // Eligible candidates with no date yet (never run, failed, or out of time).
  undated: string[];
  // Dated, but missing from the saved rankings (rankings are stale).
  unranked: string[];
};

// Which eligible candidates (opted in, passing both sides' preferences) the
// saved rankings don't cover yet, so the UI never presents a partial list as complete.
export async function getRankingCoverage(person: Profile, rankings: RankingRow[]): Promise<RankingCoverage> {
  const db = supabaseAdmin();
  const [others, dates] = await Promise.all([
    check(
      await db
        .from("profiles")
        .select("id, name, opted_in, looking_for, age, age_range_min, age_range_max, city")
        .neq("id", person.id)
        .eq("opted_in", true)
        .returns<(Preferences & { id: string })[]>()
    ),
    getDates(person.id),
  ]);
  const eligible = others.filter((o) => pairBlockers({ ...person }, o).length === 0);
  const dated = new Set(dates.map((d) => (d.person_a_id === person.id ? d.person_b_id : d.person_a_id)));
  const ranked = new Set(rankings.map((r) => r.candidate?.id));
  return {
    eligible: eligible.length,
    undated: eligible.filter((o) => !dated.has(o.id)).map((o) => o.name),
    unranked: eligible.filter((o) => dated.has(o.id) && !ranked.has(o.id)).map((o) => o.name),
  };
}

export type DemoPerson = Pick<Profile, "id" | "name" | "opted_in" | "city" | "looking_for" | "hobbies"> & {
  dates: number;
  topMatch: string | null;
  ranked: number;
};

// Everyone in the database with date counts and top match, for /demo.
export async function listDemoPeople(): Promise<DemoPerson[]> {
  const db = supabaseAdmin();
  const [people, dates, rankings] = await Promise.all([
    db.from("profiles").select("id, name, opted_in, city, looking_for, hobbies").order("name"),
    db.from("dates").select("person_a_id, person_b_id"),
    db
      .from("rankings")
      .select("person_id, rank, candidate:profiles!rankings_candidate_id_fkey(name)")
      .returns<{ person_id: string; rank: number; candidate: { name: string } | null }[]>(),
  ]);
  const profiles = check(people) as Pick<Profile, "id" | "name" | "opted_in" | "city" | "looking_for" | "hobbies">[];
  const dateCount = new Map<string, number>();
  for (const d of check(dates) as { person_a_id: string; person_b_id: string }[]) {
    for (const id of [d.person_a_id, d.person_b_id]) dateCount.set(id, (dateCount.get(id) ?? 0) + 1);
  }
  const rows = check(rankings);
  return profiles.map((p) => {
    const mine = rows.filter((r) => r.person_id === p.id);
    return {
      ...p,
      dates: dateCount.get(p.id) ?? 0,
      ranked: mine.length,
      topMatch: mine.find((r) => r.rank === 1)?.candidate?.name ?? null,
    };
  });
}
