import { createDate, PERSONA_COLUMNS, type DateRow, type PersonaRow } from "@/lib/dates";
import { generateRankingReasons } from "@/lib/llm";
import { pairBlockers, samePool } from "@/lib/matching";
import { rateLimit } from "@/lib/rate-limit";
import type { RankedDateSummary } from "@/lib/prompts";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 300;

const MAX_NEW_DATES = 10; // missing dates simulated per request; call again to fill in more
const BATCH_SIZE = 3; // concurrent Gemini calls (free tier is ~15 RPM)
// A two-agent date is 11 Gemini calls (~15s measured on flash-lite models;
// slower when models are overloaded and calls fall back). Don't start a new
// batch after this, so even a slow batch finishes inside maxDuration.
const DATE_PHASE_BUDGET_MS = 150_000;
const RESPONSE_DEADLINE_MS = 280_000; // fall back to template reasoning rather than exceed maxDuration
const MUTUAL_BONUS = 10;

type Candidate = RankedDateSummary & {
  compatibility_score: number;
  date_id: string;
};

// POST /api/rank
// Body: { person_id }
// Ranks every other opted-in profile for person_id by how their simulated date
// went. Pairs failing either side's declared preferences (city, looking_for,
// age range) are skipped entirely and listed in `filtered_out`. Candidates
// without a date yet get one simulated first (up to MAX_NEW_DATES per request,
// BATCH_SIZE at a time). Replaces person_id's rows in `rankings`.
export async function POST(request: Request) {
  const started = Date.now();
  const elapsed = () => Date.now() - started;

  let body: { person_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const personId = body.person_id;
  if (typeof personId !== "string") {
    return Response.json({ error: "person_id is required" }, { status: 400 });
  }

  const limited = await rateLimit(request, "rank");
  if (limited) return limited;

  const db = supabaseAdmin();

  const { data: person, error: personError } = await db
    .from("profiles")
    .select(PERSONA_COLUMNS)
    .eq("id", personId)
    .returns<PersonaRow[]>()
    .maybeSingle();
  if (personError) {
    if (personError.code === "22P02") {
      return Response.json({ error: "person_id must be a valid UUID" }, { status: 400 });
    }
    return Response.json({ error: `Database error: ${personError.message}` }, { status: 500 });
  }
  if (!person) return Response.json({ error: "Profile not found" }, { status: 404 });
  if (!person.opted_in) {
    return Response.json({ error: `${person.name} hasn't opted in to the dating pool` }, { status: 422 });
  }

  const [othersRes, datesRes] = await Promise.all([
    db.from("profiles").select(PERSONA_COLUMNS).neq("id", personId).eq("opted_in", true).returns<PersonaRow[]>(),
    db
      .from("dates")
      .select("*")
      .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`)
      .order("created_at", { ascending: false })
      .returns<DateRow[]>(),
  ]);
  if (othersRes.error || datesRes.error) {
    const message = (othersRes.error ?? datesRes.error)!.message;
    return Response.json({ error: `Database error: ${message}` }, { status: 500 });
  }
  // Hard filters: only pairs that pass both people's declared preferences.
  const filteredOut: { candidate_id: string; name: string; reasons: string[] }[] = [];
  // People outside this person's pool (samples vs real, see samePool) are
  // skipped silently rather than listed as filtered out.
  const others = othersRes.data.filter((o) => samePool(person, o)).filter((o) => {
    const reasons = pairBlockers(person, o);
    if (reasons.length) filteredOut.push({ candidate_id: o.id, name: o.name, reasons });
    return reasons.length === 0;
  });

  // Latest date per candidate (rows are newest first).
  const dateByCandidate = new Map<string, DateRow>();
  for (const d of datesRes.data) {
    const other = d.person_a_id === personId ? d.person_b_id : d.person_a_id;
    if (!dateByCandidate.has(other)) dateByCandidate.set(other, d);
  }

  // Simulate missing dates, BATCH_SIZE at a time, within the time budget.
  const undated = others.filter((o) => !dateByCandidate.has(o.id));
  const queue = undated.slice(0, MAX_NEW_DATES);
  const failed: { candidate_id: string; name: string; error: string }[] = [];
  let newDates = 0;

  while (queue.length > 0 && elapsed() < DATE_PHASE_BUDGET_MS) {
    const batch = queue.splice(0, BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((candidate) => createDate(db, person, candidate)));
    results.forEach((r, i) => {
      const candidate = batch[i];
      if (r.status === "fulfilled") {
        dateByCandidate.set(candidate.id, r.value);
        newDates++;
      } else {
        console.error(`[rank] date with ${candidate.id} failed:`, r.reason);
        failed.push({
          candidate_id: candidate.id,
          name: candidate.name,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });
  }
  const notDated = others
    .filter((o) => !dateByCandidate.has(o.id) && !failed.some((f) => f.candidate_id === o.id))
    .map((o) => ({ candidate_id: o.id, name: o.name }));

  // Score every candidate that has a date, from person_id's side.
  const candidates: Candidate[] = others.flatMap((o) => {
    const d = dateByCandidate.get(o.id);
    if (!d) return [];
    const iAmA = d.person_a_id === personId;
    const my = { score: iAmA ? d.score_a : d.score_b, reason: iAmA ? d.reason_a : d.reason_b, yes: iAmA ? d.second_date_a : d.second_date_b };
    const their = { score: iAmA ? d.score_b : d.score_a, reason: iAmA ? d.reason_b : d.reason_a, yes: iAmA ? d.second_date_b : d.second_date_a };
    const mutual = !!my.yes && !!their.yes;
    const scoreSum = Number(my.score ?? 0) + Number(their.score ?? 0);
    return [
      {
        candidate_id: o.id,
        candidate_name: o.name,
        shared_interest: d.shared_interest,
        my_score: my.score === null ? null : Number(my.score),
        my_reason: my.reason,
        their_score: their.score === null ? null : Number(their.score),
        their_reason: their.reason,
        mutual_second_date: mutual,
        compatibility_score: Math.round(((mutual ? MUTUAL_BONUS : 0) + scoreSum) * 10) / 10,
        date_id: d.id,
      },
    ];
  });
  candidates.sort(
    (x, y) => y.compatibility_score - x.compatibility_score || (y.my_score ?? 0) - (x.my_score ?? 0)
  );

  const reasons = await reasoningWithin(person.name, candidates, RESPONSE_DEADLINE_MS - elapsed());

  const rankings = candidates.map((c, i) => ({
    rank: i + 1,
    candidate_id: c.candidate_id,
    candidate_name: c.candidate_name,
    compatibility_score: c.compatibility_score,
    reasoning: reasons.get(c.candidate_id) ?? templateReason(c),
    mutual_second_date: c.mutual_second_date,
    my_score: c.my_score,
    their_score: c.their_score,
    shared_interest: c.shared_interest,
    date_id: c.date_id,
  }));

  const { error: deleteError } = await db.from("rankings").delete().eq("person_id", personId);
  if (deleteError) {
    return Response.json({ error: `Clearing old rankings failed: ${deleteError.message}` }, { status: 500 });
  }
  if (rankings.length > 0) {
    const { error: insertError } = await db.from("rankings").insert(
      rankings.map((r) => ({
        person_id: personId,
        candidate_id: r.candidate_id,
        rank: r.rank,
        compatibility_score: r.compatibility_score,
        reasoning: r.reasoning,
      }))
    );
    if (insertError) {
      return Response.json({ error: `Saving rankings failed: ${insertError.message}` }, { status: 500 });
    }
  }

  return Response.json({
    person: { id: person.id, name: person.name },
    rankings,
    new_dates: newDates,
    // Candidates still without a date (over MAX_NEW_DATES or out of time): call /api/rank again.
    not_dated: notDated,
    // Skipped because the pair fails someone's declared preferences.
    filtered_out: filteredOut,
    failed,
  });
}

// Gemini reasoning for all candidates in one call, abandoned (template
// fallback) if it would push the response past the deadline.
async function reasoningWithin(name: string, candidates: Candidate[], budgetMs: number) {
  if (candidates.length === 0 || budgetMs < 5_000) return new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      generateRankingReasons(name, candidates),
      new Promise<Map<string, string>>((resolve) => {
        timer = setTimeout(() => resolve(new Map()), budgetMs);
      }),
    ]);
  } catch (e) {
    console.error("[rank] reasoning generation failed, using template:", e);
    return new Map<string, string>();
  } finally {
    clearTimeout(timer);
  }
}

function templateReason(c: Candidate) {
  const interest = c.shared_interest ? ` over ${c.shared_interest}` : "";
  if (c.mutual_second_date) return `Mutual match: both want a second date after bonding${interest}.`;
  return `No mutual spark${interest}: scored ${c.my_score ?? "?"}/10 and ${c.their_score ?? "?"}/10.`;
}
