import type { Section } from "./apify";

export type PersonaProfile = {
  name: string;
  needs: string[];
  hobbies: string[];
  interests: string[];
  values: string[];
  communication_style: string | null;
  // Self-declared at ingest; lets the planner pick a venue they can both reach.
  city?: string | null;
  // Used to tag each trait with where it came from (personal vs professional).
  evidence?: { category: string; claim: string; source: "linkedin" | "instagram" }[];
};

function describePersona(label: string, p: PersonaProfile) {
  const sourceOf = (category: string, claim: string) => {
    const sources = new Set(
      (p.evidence ?? []).filter((e) => e.category === category && e.claim === claim).map((e) => e.source)
    );
    if (sources.has("instagram")) return "personal, Instagram";
    if (sources.has("linkedin")) return "professional, LinkedIn";
    return null;
  };
  const list = (category: string, items: string[]) =>
    items.length
      ? items
          .map((item) => {
            const src = sourceOf(category, item);
            return src ? `${item} [${src}]` : item;
          })
          .join(", ")
      : "(unknown)";
  return `${label}: ${p.name}
- Needs in a partner: ${list("needs", p.needs)}
- Hobbies: ${list("hobbies", p.hobbies)}
- Interests: ${list("interests", p.interests)}
- Values: ${list("values", p.values)}
- Communication style: ${p.communication_style || "(unknown)"}`;
}

// Personal life outweighs career overlap. In the first test run, dates
// between people in tech kept "bonding" over AI and smart glasses (their
// jobs) even when one person's real hobbies were pottery and trekking.
const PERSONAL_OVER_PROFESSIONAL = `What makes a good match, in priority order:
1. Shared or complementary hobbies, personal interests and values, especially those tagged [personal, Instagram]: how they actually spend their free time and what they care about.
2. Compatible needs and communication styles.
3. Last and least: same profession, industry or career topics [professional, LinkedIn]. Two people in the same field are not a match just because of that.`;

export type NamedTurn = { name: string; text: string };

const renderTranscript = (turns: NamedTurn[]) =>
  turns.length ? turns.map((t) => `${t.name}: ${t.text}`).join("\n") : "(nobody has spoken yet)";

// The only prompt that sees both personas: it sets the scene, nothing more.
export function datePlannerPrompt(a: PersonaProfile, b: PersonaProfile) {
  return `You are planning a first date between two people, based only on their personas below.

${describePersona("Person A", a)}

${describePersona("Person B", b)}

${PERSONAL_OVER_PROFESSIONAL}

${
    a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()
      ? `Both live in ${a.city}, so the venue must be in or near ${a.city}.\n\n`
      : ""
  }Return:
- shared_interest: the one personal thing they're most likely to bond over: a hobby, interest or value from their personal lives. Only fall back to work or industry if they truly share nothing personal, and say so.
- venue: a specific, creative date spot built around that shared interest (e.g. "a night kayak tour under the city bridges", not "a cafe").`;
}

// One agent's next line. It sees only its own persona, the other person's
// name, the venue and the conversation so far.
export function agentTurnPrompt(
  self: PersonaProfile,
  otherName: string,
  venue: string,
  transcript: NamedTurn[],
  turnsLeft: number
) {
  const opening = transcript.length === 0;
  return `You are ${self.name}, on a first date with ${otherName} at: ${venue}.
You only know about ${otherName} what they've said on this date.

Who you are:
${describePersona("You", self)}

Conversation so far:
${renderTranscript(transcript)}

Write ${self.name}'s next line${opening ? " to open the conversation" : ""}.
- 1-3 sentences, exactly in your communication style (tone, formality, humor, emoji use).
- Talk from your own hobbies, interests and values; like a real first date, mostly about life outside work.
- React to what ${otherName} just said. Ask questions to find out who they are; don't assume things they haven't told you.
- Be honest: if something they said doesn't sit well with your needs or values, it's fine to show it.${
    turnsLeft <= 1 ? "\n- This is the last line of the date: wrap up naturally." : ""
  }
- Return only the words you say, without your name or quotes.`;
}

// One agent's private verdict, from its own persona and the transcript only.
export function agentEvaluationPrompt(self: PersonaProfile, otherName: string, venue: string, transcript: NamedTurn[]) {
  return `You are ${self.name}. You just had a first date with ${otherName} at: ${venue}.

Who you are:
${describePersona("You", self)}

The full conversation:
${renderTranscript(transcript)}

${PERSONAL_OVER_PROFESSIONAL}

Give your honest, private verdict, judged against your own needs and values using the priorities above:
- score: 0-10 (0 = awful, 5 = neutral, 10 = perfect match). Be honest; most first dates are not a 9.
- reason: 1-2 sentences in your own voice that cite a specific moment from the conversation.
- second_date: whether you want a second date.`;
}

export function extractPersonaPrompt(name: string, sections: Section[]) {
  const body = sections.map((s) => `[${s.label}]\n${s.text}`).join("\n\n");
  return `You are building a dating persona for ${name} from their public LinkedIn and Instagram.

Below is their profile text, split into sections. Each section starts with a label in square brackets.

${body}

Extract:
- needs: what they seem to need or look for in a partner/relationship (e.g. "intellectual stimulation", "someone who travels").
- hobbies: things they actively do in their free time.
- interests: topics they care about or follow.
- values: principles that guide them (e.g. "family", "growth mindset", "service").
- communication_style: 1-2 sentences on how they express themselves (tone, humor, formality, emoji use), based on how they write.
- evidence: one entry per claim above (every item in needs, hobbies, interests, values, plus communication_style).
  - category: which field the claim belongs to.
  - claim: the exact item text as it appears in that field.
  - section: the label of the section that supports it, copied exactly without brackets (e.g. "instagram:post#3").
  - quote: a short verbatim excerpt (under 25 words) from that section.

Rules:
- Never infer or state sensitive attributes: age, gender, sexual orientation, relationship status, religion, caste, ethnicity, health or politics. Those are only ever self-declared, never guessed.
- Only make claims the text supports. Fewer, well-grounded items beat many guesses. Do not use outside knowledge about this person.
- Professional achievements are not hobbies. Infer needs and values carefully from what they post and how they describe themselves.
- Keep each item short (1-5 words).`;
}

export type RankedDateSummary = {
  candidate_id: string;
  candidate_name: string;
  shared_interest: string | null;
  my_score: number | null;
  my_reason: string | null;
  their_score: number | null;
  their_reason: string | null;
  mutual_second_date: boolean;
};

export function rankingReasonsPrompt(name: string, dates: RankedDateSummary[]) {
  const body = dates
    .map(
      (d) => `candidate_id: ${d.candidate_id}
Candidate: ${d.candidate_name}
Bonded over: ${d.shared_interest ?? "(unknown)"}
${name}'s verdict: ${d.my_score ?? "?"}/10, "${d.my_reason ?? ""}"
${d.candidate_name}'s verdict: ${d.their_score ?? "?"}/10, "${d.their_reason ?? ""}"
Mutual second date: ${d.mutual_second_date ? "yes" : "no"}`
    )
    .join("\n\n");

  return `${name} went on simulated first dates with the candidates below. For each candidate, write a one-line reasoning (max 20 words) explaining how good a match they are for ${name}, e.g. "Mutual match with high scores on shared family values" or "One-sided: ${name} loved the hiking talk, but the candidate found ${name} too formal".

Mention whether interest was mutual and the strongest specific reason from the verdicts. Prefer personal reasons (shared hobbies, interests, values, how they connected) over shared profession or industry; only cite work overlap if it's genuinely all they had in common. Return one entry per candidate_id.

${body}`;
}
