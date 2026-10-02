import type { SupabaseClient } from "@supabase/supabase-js";
import { simulateDate } from "./llm";
import type { PersonaProfile } from "./prompts";

export const PERSONA_COLUMNS = "id, name, needs, hobbies, interests, values, communication_style";

export type PersonaRow = PersonaProfile & { id: string };

export type DateRow = {
  id: string;
  person_a_id: string;
  person_b_id: string;
  transcript: { speaker: "a" | "b"; text: string }[];
  venue: string | null;
  shared_interest: string | null;
  score_a: number | null;
  score_b: number | null;
  reason_a: string | null;
  reason_b: string | null;
  second_date_a: boolean | null;
  second_date_b: boolean | null;
  created_at: string;
};

// Simulates a date between two profiles and stores it in `dates`.
export async function createDate(db: SupabaseClient, a: PersonaRow, b: PersonaRow): Promise<DateRow> {
  const sim = await simulateDate(a, b);
  const { data, error } = await db
    .from("dates")
    .insert({
      person_a_id: a.id,
      person_b_id: b.id,
      transcript: sim.transcript,
      venue: sim.venue,
      shared_interest: sim.shared_interest,
      score_a: sim.evaluation_a.score,
      score_b: sim.evaluation_b.score,
      reason_a: sim.evaluation_a.reason,
      reason_b: sim.evaluation_b.reason,
      second_date_a: sim.evaluation_a.second_date,
      second_date_b: sim.evaluation_b.second_date,
    })
    .select()
    .single();
  if (error) throw new Error(`Database insert failed: ${error.message}`);
  return data as DateRow;
}
