import type { Platform, Section } from "./apify";
import {
  agentEvaluationPrompt,
  agentTurnPrompt,
  datePlannerPrompt,
  extractPersonaPrompt,
  rankingReasonsPrompt,
  type NamedTurn,
  type PersonaProfile,
  type RankedDateSummary,
} from "./prompts";

export const GEMINI_MODEL = "gemini-3.8-flash";

// Gemini's free tier allows only ~20 requests per model per day, and flash
// models regularly return 503 "high demand". So calls rotate through a pool of
// models: a model that hits its daily quota is skipped until its reset, and an
// overloaded or rate-limited one is skipped for a minute.
// Quality calls (persona extraction, date planning, ranking reasons) prefer the
// larger flash models; the many short date turns and verdicts prefer the fast
// flash-lite models.
const QUALITY_MODELS = [
  GEMINI_MODEL,
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
];
const FAST_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.7-flash",
  GEMINI_MODEL,
  "gemini-flash-latest",
];
const MAX_ATTEMPTS = 6;
const ATTEMPT_TIMEOUT_MS = 35_000;
const FAST_ATTEMPT_TIMEOUT_MS = 20_000;
const SHORT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_WAIT_MS = 45_000;

// model -> epoch ms until which it's skipped (per server instance)
const cooldownUntil = new Map<string, number>();

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export type GenerateOptions = { fast?: boolean };

// Calls Gemini with a response schema and returns the parsed JSON.
// If the response isn't valid JSON, retries once with an explicit
// "valid JSON only" reminder.
export async function generateJSON<T>(prompt: string, schema: object, opts: GenerateOptions = {}): Promise<T> {
  const text = await generateText(prompt, schema, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    console.warn("[llm] response was not valid JSON, retrying once");
    const retry = await generateText(`${prompt}\n\nReturn valid JSON only, matching the schema exactly.`, schema, opts);
    return JSON.parse(retry) as T;
  }
}

type GeminiError = {
  error?: {
    message?: string;
    details?: { retryDelay?: string; violations?: { quotaId?: string }[] }[];
  };
};

// How long to skip a model after a 429: until the daily reset if the daily
// quota is gone, otherwise a short cooldown.
function quotaCooldownMs(err: GeminiError | null) {
  const details = err?.error?.details ?? [];
  const daily = details.some((d) => d.violations?.some((v) => v.quotaId?.includes("PerDay")));
  const delay = details.map((d) => d.retryDelay).find(Boolean);
  const delayMs = delay ? parseFloat(delay) * 1000 : NaN;
  if (daily) return Number.isFinite(delayMs) ? delayMs : 60 * 60_000;
  return Number.isFinite(delayMs) ? Math.max(delayMs, 5_000) : SHORT_COOLDOWN_MS;
}

async function generateText(prompt: string, schema: object, { fast = false }: GenerateOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const pool = fast ? FAST_MODELS : QUALITY_MODELS;
  const timeout = fast ? FAST_ATTEMPT_TIMEOUT_MS : ATTEMPT_TIMEOUT_MS;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let model = pool.find((m) => (cooldownUntil.get(m) ?? 0) <= Date.now());
    if (!model) {
      // Every model is cooling down. If one frees up soon (per-minute limits
      // reset within ~a minute), wait for it instead of failing the date.
      const soonest = Math.min(...pool.map((m) => cooldownUntil.get(m) ?? 0));
      const waitMs = soonest - Date.now();
      if (waitMs > MAX_COOLDOWN_WAIT_MS) break;
      console.warn(`[llm] all models cooling down, waiting ${Math.ceil(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs + 250));
      model = pool.find((m) => (cooldownUntil.get(m) ?? 0) <= Date.now());
      if (!model) break;
    }

    let res: Response;
    try {
      res = await fetch(endpoint(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
        }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      lastError = `${model}: ${e instanceof Error ? e.message : e}`;
      console.warn(`[llm] ${lastError}, trying another model`);
      cooldownUntil.set(model, Date.now() + SHORT_COOLDOWN_MS);
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      const text: string | undefined = data.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("");
      if (!text) {
        throw new Error(`Gemini returned no content (${data.candidates?.[0]?.finishReason ?? "no candidates"})`);
      }
      return text;
    }

    const err: GeminiError | null = await res.json().catch(() => null);
    lastError = `${model} ${res.status}: ${err?.error?.message ?? res.statusText}`;
    if (res.status === 429) {
      cooldownUntil.set(model, Date.now() + quotaCooldownMs(err));
    } else if (res.status >= 500) {
      cooldownUntil.set(model, Date.now() + SHORT_COOLDOWN_MS);
    } else if (res.status === 404) {
      cooldownUntil.set(model, Date.now() + 24 * 60 * 60_000); // retired model
    } else {
      throw new Error(`Gemini ${lastError}`);
    }
    console.warn(`[llm] ${model} returned ${res.status}, trying another model`);
  }

  const next = Math.min(...pool.map((m) => cooldownUntil.get(m) ?? 0));
  throw new Error(
    next > Date.now()
      ? `All Gemini models are busy or out of free-tier quota; try again after ${new Date(next).toLocaleTimeString()}. Last error: ${lastError}`
      : `Gemini request failed: ${lastError}`
  );
}

// ---------- Persona extraction ----------

export type Category = "needs" | "hobbies" | "interests" | "values" | "communication_style";

export type Evidence = {
  category: Category;
  claim: string;
  source: Platform;
  section: string;
  quote: string;
  // false when the quote isn't found verbatim in the cited section
  quote_verified: boolean;
};

export type CitationStats = {
  proposed: number; // citations Gemini returned
  verified: number; // section exists and quote found verbatim
};

export type Persona = {
  citation_stats: CitationStats;
  needs: string[];
  hobbies: string[];
  interests: string[];
  values: string[];
  communication_style: string;
  evidence: Evidence[];
};

const stringList = { type: "array", items: { type: "string" } };

const personaSchema = {
  type: "object",
  properties: {
    needs: stringList,
    hobbies: stringList,
    interests: stringList,
    values: stringList,
    communication_style: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["needs", "hobbies", "interests", "values", "communication_style"] },
          claim: { type: "string" },
          section: { type: "string" },
          quote: { type: "string" },
        },
        required: ["category", "claim", "section", "quote"],
      },
    },
  },
  required: ["needs", "hobbies", "interests", "values", "communication_style", "evidence"],
};

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function extractPersona(name: string, sections: Section[]): Promise<Persona> {
  const raw = await generateJSON<
    Omit<Persona, "evidence" | "citation_stats"> & { evidence: Omit<Evidence, "source" | "quote_verified">[] }
  >(
    extractPersonaPrompt(name, sections),
    personaSchema
  );

  // Keep only citations that point at a real section AND whose quote appears
  // verbatim (case/whitespace-insensitive) in that section; then drop any
  // claim left without evidence. Every stored claim has a verified quote.
  const byLabel = new Map(sections.map((s) => [s.label, normalize(s.text)]));
  const evidence: Evidence[] = raw.evidence
    .map((e) => ({ ...e, section: e.section.replace(/^\[|\]$/g, "").trim() }))
    .filter((e) => byLabel.has(e.section))
    .map((e) => ({
      ...e,
      source: e.section.split(":")[0] as Platform,
      quote_verified: byLabel.get(e.section)!.includes(normalize(e.quote).replace(/^["“]|["”]$/g, "")),
    }))
    .filter((e) => e.quote_verified);
  const dropped = raw.evidence.length - evidence.length;
  if (dropped > 0) console.log(`[llm] dropped ${dropped} of ${raw.evidence.length} citations that didn't verify`);

  const supported = (category: Category, claim: string) =>
    evidence.some((e) => e.category === category && normalize(e.claim) === normalize(claim));
  const keep = (category: "needs" | "hobbies" | "interests" | "values") =>
    [...new Set(raw[category])].filter((c) => supported(category, c));

  const persona = {
    needs: keep("needs"),
    hobbies: keep("hobbies"),
    interests: keep("interests"),
    values: keep("values"),
    communication_style: raw.communication_style,
  };
  const kept = (e: Evidence) =>
    e.category === "communication_style" || persona[e.category].some((c) => normalize(c) === normalize(e.claim));

  return {
    ...persona,
    evidence: evidence.filter(kept),
    citation_stats: { proposed: raw.evidence.length, verified: evidence.length },
  };
}

// ---------- Date simulation ----------

export type Turn = { speaker: "a" | "b"; text: string };
export type Evaluation = { score: number; reason: string; second_date: boolean };

export type DateSimulation = {
  shared_interest: string;
  venue: string;
  transcript: Turn[];
  evaluation_a: Evaluation;
  evaluation_b: Evaluation;
  first_speaker: "a" | "b";
  duration_ms: number;
};

export const DATE_TURNS = 8; // 4 each

const planSchema = {
  type: "object",
  properties: { shared_interest: { type: "string" }, venue: { type: "string" } },
  required: ["shared_interest", "venue"],
};

const turnSchema = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
};

const evaluationSchema = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 10 },
    reason: { type: "string" },
    second_date: { type: "boolean" },
  },
  required: ["score", "reason", "second_date"],
};

const clampScore = (n: number) => Math.round(Math.min(10, Math.max(0, Number(n) || 0)) * 10) / 10;

// A real two-agent date:
// 1. A planner (the only call that sees both personas) picks the venue.
// 2. The agents alternate for DATE_TURNS turns, one call per turn. Each agent's
//    prompt holds only its own persona, the other person's name, the venue and
//    the transcript so far.
// 3. Each agent privately evaluates the date from its own persona + transcript.
// `firstSpeaker` defaults to random so neither side always opens.
export async function simulateDate(
  a: PersonaProfile,
  b: PersonaProfile,
  firstSpeaker: "a" | "b" = Math.random() < 0.5 ? "a" : "b"
): Promise<DateSimulation> {
  const started = Date.now();
  const plan = await generateJSON<{ shared_interest: string; venue: string }>(datePlannerPrompt(a, b), planSchema, {
    fast: true,
  });

  const people = { a, b };
  const transcript: Turn[] = [];
  for (let i = 0; i < DATE_TURNS; i++) {
    const speaker: "a" | "b" = i % 2 === 0 ? firstSpeaker : firstSpeaker === "a" ? "b" : "a";
    const self = people[speaker];
    const other = people[speaker === "a" ? "b" : "a"];
    const { text } = await generateJSON<{ text: string }>(
      agentTurnPrompt(self, other.name, plan.venue, toNamedTurns(transcript, people), DATE_TURNS - i),
      turnSchema,
      { fast: true }
    );
    const clean = text?.trim().replace(new RegExp(`^${escapeRegExp(self.name)}:\\s*`), "");
    if (!clean) throw new Error(`Agent ${self.name} returned an empty turn`);
    transcript.push({ speaker, text: clean });
  }

  const named = toNamedTurns(transcript, people);
  const evaluate = (self: PersonaProfile, other: PersonaProfile) =>
    generateJSON<Evaluation>(agentEvaluationPrompt(self, other.name, plan.venue, named), evaluationSchema, {
      fast: true,
    }).then((e) => ({ ...e, score: clampScore(e.score) }));
  const [evaluation_a, evaluation_b] = await Promise.all([evaluate(a, b), evaluate(b, a)]);

  return {
    shared_interest: plan.shared_interest,
    venue: plan.venue,
    transcript,
    evaluation_a,
    evaluation_b,
    first_speaker: firstSpeaker,
    duration_ms: Date.now() - started,
  };
}

const toNamedTurns = (turns: Turn[], people: { a: PersonaProfile; b: PersonaProfile }): NamedTurn[] =>
  turns.map((t) => ({ name: people[t.speaker].name, text: t.text }));

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- Ranking reasons ----------

const reasonsSchema = {
  type: "object",
  properties: {
    reasons: {
      type: "array",
      items: {
        type: "object",
        properties: { candidate_id: { type: "string" }, reasoning: { type: "string" } },
        required: ["candidate_id", "reasoning"],
      },
    },
  },
  required: ["reasons"],
};

// One call for all candidates; returns candidate_id -> one-line reasoning.
export async function generateRankingReasons(name: string, dates: RankedDateSummary[]): Promise<Map<string, string>> {
  if (dates.length === 0) return new Map();
  const { reasons } = await generateJSON<{ reasons: { candidate_id: string; reasoning: string }[] }>(
    rankingReasonsPrompt(name, dates),
    reasonsSchema
  );
  return new Map(reasons.map((r) => [r.candidate_id.trim(), r.reasoning.trim()]));
}
