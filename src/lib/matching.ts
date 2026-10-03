// Hard filters applied before any date is simulated. Every value here is
// self-declared at ingest; nothing is inferred from LinkedIn or Instagram.

export const LOOKING_FOR = ["long-term", "short-term", "friendship-first", "open"] as const;
export type LookingFor = (typeof LOOKING_FOR)[number];

export type Preferences = {
  name: string;
  opted_in: boolean;
  looking_for: LookingFor | null;
  age: number | null;
  age_range_min: number | null;
  age_range_max: number | null;
  city: string | null;
};

const sameCity = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// One-directional check: does `candidate` satisfy what `seeker` declared?
// A preference only filters when the seeker declared it. An age range
// requires the candidate to have declared an age inside it.
function unmet(seeker: Preferences, candidate: Preferences): string[] {
  const reasons: string[] = [];
  const { age_range_min: min, age_range_max: max } = seeker;
  if (min !== null || max !== null) {
    const range = `${min ?? 18}-${max ?? "any"}`;
    if (candidate.age === null) reasons.push(`${seeker.name} wants ages ${range}; ${candidate.name} hasn't declared an age`);
    else if ((min !== null && candidate.age < min) || (max !== null && candidate.age > max))
      reasons.push(`${candidate.name} (${candidate.age}) is outside ${seeker.name}'s age range ${range}`);
  }
  return reasons;
}

// Returns why a pair can't date; empty means they can.
export function pairBlockers(a: Preferences, b: Preferences): string[] {
  const reasons: string[] = [];
  if (!a.opted_in) reasons.push(`${a.name} hasn't opted in to the dating pool`);
  if (!b.opted_in) reasons.push(`${b.name} hasn't opted in to the dating pool`);
  if (a.city && b.city && !sameCity(a.city, b.city)) reasons.push(`different cities (${a.city} vs ${b.city})`);
  if (a.looking_for && b.looking_for && a.looking_for !== b.looking_for && a.looking_for !== "open" && b.looking_for !== "open")
    reasons.push(`looking for different things (${a.looking_for} vs ${b.looking_for})`);
  return [...reasons, ...unmet(a, b), ...unmet(b, a)];
}

export type PreferenceInput = Omit<Preferences, "name" | "opted_in">;

// Validates the optional self-declared fields from an ingest request.
export function parsePreferences(body: Record<string, unknown>): { value: PreferenceInput } | { error: string } {
  const int = (key: string): number | null | string => {
    const v = body[key];
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 18 && n <= 120 ? n : `${key} must be a whole number from 18 to 120`;
  };
  const age = int("age");
  const min = int("age_range_min");
  const max = int("age_range_max");
  for (const v of [age, min, max]) if (typeof v === "string") return { error: v };
  if (typeof min === "number" && typeof max === "number" && min > max) {
    return { error: "age_range_min can't be greater than age_range_max" };
  }

  const lf = body.looking_for;
  if (lf !== undefined && lf !== null && lf !== "" && !LOOKING_FOR.includes(lf as LookingFor)) {
    return { error: `looking_for must be one of: ${LOOKING_FOR.join(", ")}` };
  }
  const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : null;

  return {
    value: {
      looking_for: lf ? (lf as LookingFor) : null,
      age: age as number | null,
      age_range_min: min as number | null,
      age_range_max: max as number | null,
      city,
    },
  };
}
