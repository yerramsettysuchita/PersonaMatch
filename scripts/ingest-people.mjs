// Ingests real, consenting people listed in scripts/people.json, then dates and
// ranks everyone in the real pool until the rankings are complete.
//
// 1. Copy scripts/people.example.json to scripts/people.json (git-ignored: it
//    holds real people's details) and fill in one entry per person.
// 2. Every entry needs "consent": true, recorded only after that person agreed
//    to have their public LinkedIn and Instagram used. Entries without it are
//    skipped, never scraped.
// 3. npm run dev, then in another terminal: npm run ingest:people
//
// Re-runnable: re-ingesting the same LinkedIn URL updates that profile, and
// scrapes are cached for 24h. Run it against the local dev server: production
// rate-limits ingest to 5 per hour per IP.
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3005";
const FILE = new URL("./people.json", import.meta.url);
const MAX_RANK_ROUNDS = 6;

if (!existsSync(FILE)) {
  console.error("scripts/people.json not found. Copy scripts/people.example.json to scripts/people.json and fill it in.");
  process.exit(1);
}
const people = JSON.parse(readFileSync(FILE, "utf8"));
process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const label = (p, i) => p.name || p.linkedin_url || p.instagram_url || `entry ${i + 1}`;
const results = { saved: [], needsPaste: [], identity: [], skipped: [], failed: [] };

// One at a time: each ingest is two scrapes plus a Gemini call.
for (const [i, person] of people.entries()) {
  const who = label(person, i);
  if (person.consent !== true) {
    results.skipped.push(`${who}: no "consent": true`);
    console.log(`skip     ${who} (no recorded consent)`);
    continue;
  }
  const fields = { ...person };
  delete fields.consent;
  const { status, data } = await post("/api/ingest", { ...fields, opted_in: true });

  if (status === 200 || status === 201) {
    results.saved.push(data.profile.name);
    console.log(`${status === 200 ? "updated" : "added  "}  ${data.profile.name}`);
  } else if (status === 422 && data.needs_manual) {
    results.needsPaste.push(`${who}: add ${data.needs_manual.map((p) => `"${p}_text"`).join(" and ")} (${data.error})`);
    console.log(`paste    ${who}: ${data.error}`);
  } else if (status === 409 && data.identity_mismatch) {
    const { linkedin_name, instagram_name } = data.identity_mismatch;
    results.identity.push(`${who}: LinkedIn "${linkedin_name}" vs Instagram "${instagram_name}"`);
    console.log(`check    ${who}: LinkedIn "${linkedin_name}" vs Instagram "${instagram_name}"`);
  } else {
    results.failed.push(`${who}: HTTP ${status} ${data.error ?? ""}`);
    console.log(`FAILED   ${who}: HTTP ${status} ${data.error ?? ""}`);
  }
}

// Date and rank everyone in the real (non-sample) pool.
const { data: pool, error } = await db
  .from("profiles")
  .select("id, name")
  .eq("opted_in", true)
  .eq("is_sample", false)
  .order("name");
if (error) throw new Error(error.message);
console.log(`\nDating and ranking ${pool.length} people in the real pool...`);

const incomplete = [];
for (const person of pool) {
  let last;
  for (let round = 1; round <= MAX_RANK_ROUNDS; round++) {
    const { status, data } = await post("/api/rank", { person_id: person.id });
    if (status !== 200) {
      last = { error: data.error ?? `HTTP ${status}` };
      break;
    }
    last = data;
    if (data.not_dated.length === 0 && data.failed.length === 0) break;
  }
  if (last.error) {
    incomplete.push(`${person.name}: ${last.error}`);
    console.log(`rank     ${person.name}: FAILED ${last.error}`);
  } else {
    const missing = last.not_dated.length + last.failed.length;
    if (missing) incomplete.push(`${person.name}: ${missing} candidates still undated (${last.failed[0]?.error ?? "out of time"})`);
    console.log(
      `rank     ${person.name}: ${last.rankings.length} ranked, ${last.filtered_out.length} filtered out` +
        (missing ? `, ${missing} STILL MISSING` : "")
    );
  }
}

console.log(`\nSummary
  saved:            ${results.saved.length}
  need pasted text: ${results.needsPaste.length}${results.needsPaste.map((s) => `\n    - ${s}`).join("")}
  identity check:   ${results.identity.length}${results.identity.map((s) => `\n    - ${s}`).join("")}
    (verify, then add "confirm_identity": true to that entry and re-run)
  skipped:          ${results.skipped.length}${results.skipped.map((s) => `\n    - ${s}`).join("")}
  failed:           ${results.failed.length}${results.failed.map((s) => `\n    - ${s}`).join("")}
  real pool:        ${pool.length} opted-in people
  rankings incomplete: ${incomplete.length}${incomplete.map((s) => `\n    - ${s}`).join("")}`);
if (incomplete.length) console.log("Re-run npm run ingest:people to fill in the rest (usually Gemini quota).");
