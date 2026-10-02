import type { Section } from "./apify";

export type PersonaProfile = {
  name: string;
  needs: string[];
  hobbies: string[];
  interests: string[];
  values: string[];
  communication_style: string | null;
};

function describePersona(label: string, p: PersonaProfile) {
  const list = (items: string[]) => (items.length ? items.join(", ") : "(unknown)");
  return `${label}: ${p.name}
- Needs in a partner: ${list(p.needs)}
- Hobbies: ${list(p.hobbies)}
- Interests: ${list(p.interests)}
- Values: ${list(p.values)}
- Communication style: ${p.communication_style || "(unknown)"}`;
}

export function simulateDatePrompt(a: PersonaProfile, b: PersonaProfile) {
  return `Simulate a first date between two people, based only on their personas below.

${describePersona("Person A", a)}

${describePersona("Person B", b)}

Generate:
- shared_interest: the one thing from their personas they genuinely bond over. If they share nothing obvious, pick the closest overlap and say what it is.
- venue: a specific, creative date spot built around that shared interest (e.g. "a night kayak tour under the city bridges", not "a cafe").
- transcript: a natural 6-8 turn conversation at the venue, alternating speakers, starting with Person A.
  - Each person must speak exactly in their communication style (tone, formality, humor, emoji use) and talk from their own hobbies, interests and values.
  - Let real friction show if their needs or values clash. Don't make it artificially perfect.
  - Each turn is 1-3 sentences.
- evaluation_a: Person A's honest private verdict after the date, judged against A's own needs and values.
  - score: 0-10 (0 = awful, 5 = neutral, 10 = perfect match).
  - reason: 1-2 sentences in A's voice, citing specific moments from the conversation.
  - second_date: whether A wants a second date.
- evaluation_b: the same, from Person B's perspective.

Score each side independently; the two people can feel differently about the same date.`;
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

Mention whether interest was mutual and the strongest specific reason from the verdicts. Return one entry per candidate_id.

${body}`;
}
