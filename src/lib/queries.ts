// Server-side reads for the pages. Uses the service-role client, so only
// import this from Server Components.
import type { InstagramData, LinkedInData, PastedData } from "./apify";
import type { DateRow } from "./dates";
import type { Evidence } from "./llm";
import { pairBlockers, samePool, type Preferences } from "./matching";
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

export type ProfileSummary = Pick<Profile, "id" | "name" | "created_at" | "is_sample">;

export type RankingRow = {
  rank: number;
  compatibility_score: number;
  reasoning: string | null;
  created_at: string;
  candidate: { id: string; name: string; is_sample: boolean } | null;
};

export type DateWithPeople = DateRow & {
  person_a: { id: string; name: string; is_sample: boolean } | null;
  person_b: { id: string; name: string; is_sample: boolean } | null;
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
    await supabaseAdmin().from("profiles").select("id, name, created_at, is_sample").order("created_at", { ascending: false }).limit(limit)
  );
}

export async function getRankings(personId: string): Promise<RankingRow[]> {
  return check(
    await supabaseAdmin()
      .from("rankings")
      .select("rank, compatibility_score, reasoning, created_at, candidate:profiles!rankings_candidate_id_fkey(id, name, is_sample)")
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
        "*, person_a:profiles!dates_person_a_id_fkey(id, name, is_sample), person_b:profiles!dates_person_b_id_fkey(id, name, is_sample)"
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
        .select("id, name, opted_in, looking_for, age, age_range_min, age_range_max, city, is_sample, sandbox_opt_in")
        .neq("id", person.id)
        .eq("opted_in", true)
        .returns<(Preferences & { id: string })[]>()
    ),
    getDates(person.id),
  ]);
  const eligible = others.filter((o) => samePool(person, o) && pairBlockers({ ...person }, o).length === 0);
  const dated = new Set(dates.map((d) => (d.person_a_id === person.id ? d.person_b_id : d.person_a_id)));
  const ranked = new Set(rankings.map((r) => r.candidate?.id));
  return {
    eligible: eligible.length,
    undated: eligible.filter((o) => !dated.has(o.id)).map((o) => o.name),
    unranked: eligible.filter((o) => dated.has(o.id) && !ranked.has(o.id)).map((o) => o.name),
  };
}
