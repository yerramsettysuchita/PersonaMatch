// Server-side reads for the pages. Uses the service-role client, so only
// import this from Server Components.
import type { InstagramData, LinkedInData, PastedData } from "./apify";
import type { DateRow } from "./dates";
import type { Evidence } from "./llm";
import { supabaseAdmin } from "./supabase";
import { isUuid } from "./utils";

export type Profile = {
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
