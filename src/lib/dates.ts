import type { SupabaseClient } from "@supabase/supabase-js";
import { simulateDate } from "./llm";
import type { Preferences } from "./matching";
import type { PersonaProfile } from "./prompts";

export const PERSONA_COLUMNS =
  "id, name, needs, hobbies, interests, values, communication_style, evidence, " +
  "opted_in, looking_for, age, age_range_min, age_range_max, city, is_sample";

export type PersonaRow = PersonaProfile & Preferences & { id: string };

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

// Simulates a two-agent date between two profiles and stores it in `dates`.
// Which person is stored as person_a is randomised (and simulateDate picks a
// random first speaker), so the person being ranked isn't always side A.
export async function createDate(db: SupabaseClient, x: PersonaRow, y: PersonaRow): Promise<DateRow> {
  const [a, b] = Math.random() < 0.5 ? [x, y] : [y, x];
  const sim = await simulateDate(a, b);
  console.log(
    `[date] ${a.name} × ${b.name}: ${(sim.duration_ms / 1000).toFixed(1)}s, ` +
      `${sim.transcript.length} turns, ${sim.first_speaker === "a" ? a.name : b.name} spoke first`
  );
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
