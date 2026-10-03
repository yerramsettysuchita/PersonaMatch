// Evaluates PersonaMatch over everything stored in Supabase and writes EVAL.md.
//
//   npm run eval                    full report, incl. consistency re-runs
//   EVAL_RERUNS=0 npm run eval      skip re-runs (no Gemini calls)//
// Consistency re-runs call simulateDate directly and are NOT stored, so they
// don't change anyone's dates or rankings. Each re-run is 11 Gemini calls.
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { DateRow, PersonaRow } from "../src/lib/dates";
import { simulateDate } from "../src/lib/llm";

process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const PAIRS = 5;
const RERUNS = Number(process.env.EVAL_RERUNS ?? 1);
type ProfileRow = PersonaRow & {
  citation_stats: { proposed: number; verified: number } | null;
  evidence: { category: string; source: "linkedin" | "instagram" }[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const variance = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) : NaN;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");

async function main() {
  const [{ data: profiles, error: pe }, { data: dates, error: de }] = await Promise.all([
    db.from("profiles").select("*").order("name").returns<ProfileRow[]>(),
    db.from("dates").select("*").returns<DateRow[]>(),
  ]);
  if (pe || de) throw new Error((pe ?? de)!.message);  const byId = new Map(profiles.map((p) => [p.id, p]));
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  line("# PersonaMatch evaluation");
  line();
  line(
    `Generated ${new Date().toISOString()} by \`npm run eval\` over ${profiles.length} profiles ` +
      `(${profiles.filter((p) => p.opted_in).length} opted in) and ${dates.length} dates.`
  );
  line();

  // 1. Citation verification
  line("## 1. Citation verification");
  line();
  line("A citation verifies when its section exists and its quote appears verbatim in that section. Only verified citations (and the claims they support) are stored.");
  line();
  line("| Profile | Proposed | Verified | Rate |");
  line("| --- | ---: | ---: | ---: |");
  let proposed = 0;
  let verified = 0;
  for (const p of profiles) {
    const s = p.citation_stats;
    if (!s) {
      line(`| ${p.name} | n/a | n/a | not recorded (ingested before stats existed) |`);
      continue;
    }
    proposed += s.proposed;
    verified += s.verified;
    line(`| ${p.name} | ${s.proposed} | ${s.verified} | ${pct(s.verified, s.proposed)} |`);
  }
  line(`| **Overall** | **${proposed}** | **${verified}** | **${pct(verified, proposed)}** |`);
  line();

  // 2. Claim sources
  const claims = profiles.flatMap((p) => p.evidence ?? []).filter((e) => e.category !== "communication_style");
  const ig = claims.filter((e) => e.source === "instagram").length;
  const li = claims.filter((e) => e.source === "linkedin").length;
  line("## 2. Where claims come from");
  line();
  line(`Across ${claims.length} stored claims (needs, hobbies, interests, values): **${pct(ig, claims.length)} Instagram**, **${pct(li, claims.length)} LinkedIn**.`);
  line();
  line("| Category | Instagram | LinkedIn |");
  line("| --- | ---: | ---: |");
  for (const cat of ["needs", "hobbies", "interests", "values"]) {
    const c = claims.filter((e) => e.category === cat);
    line(`| ${cat} | ${c.filter((e) => e.source === "instagram").length} | ${c.filter((e) => e.source === "linkedin").length} |`);
  }
  line();

  // 3. Scores and second-date agreement
  const scores = dates.flatMap((d) => [d.score_a, d.score_b]).filter((s): s is number => s !== null).map(Number);
  line("## 3. Date scores and second-date agreement");
  line();
  if (dates.length === 0) {
    line("No dates yet.");
  } else {
    line(`${scores.length} verdicts from ${dates.length} dates: mean **${f2(mean(scores))}**, median **${f2(median(scores))}**, std dev **${f2(Math.sqrt(variance(scores)))}**, range ${Math.min(...scores)}–${Math.max(...scores)}.`);
    line();
    line("| Score | Count |");
    line("| --- | ---: |");
    for (const [lo, hi] of [[0, 2], [3, 4], [5, 6], [7, 8], [9, 10]]) {
      line(`| ${lo}–${hi} | ${scores.filter((s) => s >= lo && s < hi + 1).length} |`);
    }
    const bothYes = dates.filter((d) => d.second_date_a && d.second_date_b).length;
    const bothNo = dates.filter((d) => !d.second_date_a && !d.second_date_b).length;
    line();
    line(`Second date: both yes **${pct(bothYes, dates.length)}**, both no **${pct(bothNo, dates.length)}**, sides agree **${pct(bothYes + bothNo, dates.length)}**, disagree **${pct(dates.length - bothYes - bothNo, dates.length)}**.`);
  }
  line();

  // 4. Position bias
  const first: number[] = [];
  const second: number[] = [];
  for (const d of dates) {
    const opener = d.transcript[0]?.speaker;
    if (!opener || d.score_a === null || d.score_b === null) continue;
    (opener === "a" ? first : second).push(Number(d.score_a));
    (opener === "b" ? first : second).push(Number(d.score_b));
  }
  line("## 4. Position bias");
  line();
  line("Who opens each date is random. Mean score given by the person who spoke first vs second:");
  line();
  line(`| Spoke first | Spoke second | Difference |`);
  line(`| ---: | ---: | ---: |`);
  line(`| ${f2(mean(first))} (n=${first.length}) | ${f2(mean(second))} (n=${second.length}) | ${f2(mean(first) - mean(second))} |`);
  line();

  // 5. Consistency
  line("## 5. Consistency (re-running the same pair)");
  line();
  if (RERUNS <= 0 || dates.length === 0) {
    line("Skipped (EVAL_RERUNS=0 or no dates).");
  } else {
    const sample = [...dates].sort(() => Math.random() - 0.5).slice(0, PAIRS);
    line(`${sample.length} random dated pairs, each re-simulated ${RERUNS} more time${RERUNS === 1 ? "" : "s"} with the same two personas (not stored). Variance is the sample variance of each person's score across the original + re-runs.`);
    line();
    line("| Pair | Person A scores | Person B scores | Var A | Var B | Second-date votes stable |");
    line("| --- | --- | --- | ---: | ---: | --- |");
    const allVar: number[] = [];
    for (const d of sample) {
      const a = byId.get(d.person_a_id);
      const b = byId.get(d.person_b_id);
      if (!a || !b) continue;
      const sa = [Number(d.score_a)];
      const sb = [Number(d.score_b)];
      const votes = [`${d.second_date_a}/${d.second_date_b}`];
      for (let i = 0; i < RERUNS; i++) {
        try {
          const sim = await simulateDate(a, b);
          sa.push(sim.evaluation_a.score);
          sb.push(sim.evaluation_b.score);
          votes.push(`${sim.evaluation_a.second_date}/${sim.evaluation_b.second_date}`);
          console.log(`re-ran ${a.name} × ${b.name} in ${(sim.duration_ms / 1000).toFixed(1)}s`);
        } catch (e) {
          console.error(`re-run failed for ${a.name} × ${b.name}:`, e instanceof Error ? e.message : e);
        }
      }
      allVar.push(variance(sa), variance(sb));
      line(`| ${a.name} × ${b.name} | ${sa.join(", ")} | ${sb.join(", ")} | ${f2(variance(sa))} | ${f2(variance(sb))} | ${new Set(votes).size === 1 ? "yes" : `no (${votes.join(" → ")})`} |`);
    }
    const finite = allVar.filter(Number.isFinite);
    line();
    line(`Mean score variance across re-runs: **${f2(mean(finite))}** (std dev ≈ ${f2(Math.sqrt(mean(finite)))} points on a 0–10 scale).`);
  }
  line();

  writeFileSync("EVAL.md", out.join("\n"));
  console.log(out.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
