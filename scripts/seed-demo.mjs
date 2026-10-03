// Seeds the fictional demo profiles in scripts/demo-profiles.json through the
// ingest API (pasted-text path, so no Apify credit is used).
// These are made-up people, not real users: they're flagged is_sample, labelled
// "Fictional sample" everywhere in the UI, and excluded from npm run eval.
// They only date each other and real people who set sandbox_opt_in; real
// people go through scripts/ingest-people.mjs.
//
// By default this only ingests the samples. SEED_RANK=1 also dates and ranks
// the samples among themselves (11 Gemini calls per date).
//
// Re-runnable: people already in the database are skipped.
// Usage: npm run seed:demo                       (local dev server on :3005)
//        BASE_URL=https://your-app.vercel.app npm run seed:demo
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3005";
const people = JSON.parse(readFileSync(new URL("./demo-profiles.json", import.meta.url), "utf8"));

// Skip demo people who are already in the database (re-runnable).
process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: existing, error } = await db.from("profiles").select("id, name").in("name", people.map((p) => p.name));
if (error) throw new Error(error.message);
const existingByName = new Map(existing.map((p) => [p.name, p.id]));

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${data.error ?? res.statusText}`);
  return data;
}

// One at a time to stay under Gemini's free-tier rate limit.
const ids = [];
for (const person of people) {
  if (existingByName.has(person.name)) {
    ids.push(existingByName.get(person.name));
    console.log(`already exists: ${person.name}`);
    continue;
  }
  const { profile } = await post("/api/ingest", { ...person, opted_in: true });
  const { error: flagError } = await db.from("profiles").update({ is_sample: true }).eq("id", profile.id);
  if (flagError) throw new Error(flagError.message);
  ids.push(profile.id);
  console.log(`ingested ${profile.name}`);
}

// /api/rank simulates up to 10 missing dates per call; repeat until none are left.
if (process.env.SEED_RANK !== "1") {
  console.log("Samples ingested. Set SEED_RANK=1 to also date and rank them among themselves.");
  process.exit(0);
}
for (const id of ids) {
  for (let pass = 1; pass <= 3; pass++) {
    const r = await post("/api/rank", { person_id: id });
    console.log(
      `ranked ${r.person.name}: ${r.rankings.length} ranked, ${r.new_dates} new dates, ` +
        `${r.filtered_out.length} filtered out, ${r.not_dated.length} still undated, ${r.failed.length} failed`
    );
    if (r.not_dated.length === 0 && r.failed.length === 0) break;
  }
}
