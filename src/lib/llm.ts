import type { Platform, Section } from "./apify";
import {
  extractPersonaPrompt,
  rankingReasonsPrompt,
  simulateDatePrompt,
  type PersonaProfile,
  type RankedDateSummary,
} from "./prompts";

export const GEMINI_MODEL = "gemini-3.8-flash";
// Gemini flash models regularly return 503 "high demand" (often after 20-30s).
// When a model is overloaded, rate limited, or too slow, move down this list.
const ATTEMPTS = [GEMINI_MODEL, "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.1-flash-lite"];
const ATTEMPT_TIMEOUT_MS = 35_000;

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Calls Gemini with a response schema and returns the parsed JSON.
// Retries rate limits (free tier is ~15 RPM), transient 5xx errors and
// timeouts, moving to the next model in ATTEMPTS after each failure.
export async function generateJSON<T>(prompt: string, schema: object): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  for (let attempt = 1; ; attempt++) {
    const model = ATTEMPTS[attempt - 1];
    const isLast = attempt >= ATTEMPTS.length;

    let res: Response;
    try {
      res = await fetch(endpoint(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
        }),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (e) {
      if (isLast) throw new Error(`Gemini ${model} request failed: ${e instanceof Error ? e.message : e}`);
      console.warn(`[llm] ${model} attempt ${attempt} failed (${e instanceof Error ? e.name : e}), retrying`);
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
      return JSON.parse(text) as T;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || isLast) {
      const err = await res.json().catch(() => null);
      throw new Error(`Gemini ${model} ${res.status}: ${err?.error?.message ?? res.statusText}`);
    }
    console.warn(`[llm] ${model} attempt ${attempt} returned ${res.status}, retrying`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
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

export type Persona = {
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
  const raw = await generateJSON<Omit<Persona, "evidence"> & { evidence: Omit<Evidence, "source" | "quote_verified">[] }>(
    extractPersonaPrompt(name, sections),
    personaSchema
  );

  // Drop citations that point at sections that don't exist, then drop any
  // claim left without evidence, so every stored claim is traceable.
  const byLabel = new Map(sections.map((s) => [s.label, normalize(s.text)]));
  const evidence: Evidence[] = raw.evidence
    .map((e) => ({ ...e, section: e.section.replace(/^\[|\]$/g, "").trim() }))
    .filter((e) => byLabel.has(e.section))
    .map((e) => ({
      ...e,
      source: e.section.split(":")[0] as Platform,
      quote_verified: byLabel.get(e.section)!.includes(normalize(e.quote).replace(/^["“]|["”]$/g, "")),
    }));

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

  return { ...persona, evidence: evidence.filter(kept) };
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

const dateSchema = {
  type: "object",
  properties: {
    shared_interest: { type: "string" },
    venue: { type: "string" },
    transcript: {
      type: "array",
      minItems: 6,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["a", "b"] },
          text: { type: "string" },
        },
        required: ["speaker", "text"],
      },
    },
    evaluation_a: evaluationSchema,
    evaluation_b: evaluationSchema,
  },
  required: ["shared_interest", "venue", "transcript", "evaluation_a", "evaluation_b"],
};

const clampScore = (n: number) => Math.round(Math.min(10, Math.max(0, Number(n) || 0)) * 10) / 10;

// Simulates the whole date (venue, conversation, both verdicts) in one call.
export async function simulateDate(a: PersonaProfile, b: PersonaProfile): Promise<DateSimulation> {
  const raw = await generateJSON<DateSimulation>(simulateDatePrompt(a, b), dateSchema);

  const transcript = raw.transcript.filter((t) => (t.speaker === "a" || t.speaker === "b") && t.text?.trim());
  if (transcript.length < 2) throw new Error("Gemini returned an empty date transcript");

  return {
    ...raw,
    transcript,
    evaluation_a: { ...raw.evaluation_a, score: clampScore(raw.evaluation_a.score) },
    evaluation_b: { ...raw.evaluation_b, score: clampScore(raw.evaluation_b.score) },
  };
}

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
