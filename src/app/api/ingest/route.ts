import {
  instagramSections,
  instagramUsername,
  linkedinSections,
  normalizeLinkedInUrl,
  scrapeInstagram,
  scrapeLinkedIn,
  type InstagramData,
  type LinkedInData,
  type PastedData,
  type Platform,
} from "@/lib/apify";
import { extractPersona } from "@/lib/llm";
import { parsePreferences } from "@/lib/matching";
import { MAX_PROFILES, rateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase";

// Two Apify runs in parallel (~30-90s) plus one Gemini call.
export const maxDuration = 300;

type IngestBody = {
  name?: string;
  linkedin_url?: string;
  instagram_url?: string;
  // Manual fallback: pasted profile text. When present, that platform is not scraped.
  linkedin_text?: string;
  instagram_text?: string;
  // Consent is required: nobody is scraped or stored without it.
  opted_in?: boolean;
  // Optional, self-declared (never inferred): see parsePreferences.
  looking_for?: string;
  age?: number;
  age_range_min?: number;
  age_range_max?: number;
  city?: string;
  // Set after the user confirms a 409 "may not be the same person" warning.
  confirm_identity?: boolean;
};

type SourceResult<T> =
  | { status: "scraped" | "pasted"; data: T | PastedData }
  | { status: "failed"; error: string };

const MIN_PASTE_CHARS = 20;

async function resolveSource<T>(
  platform: Platform,
  url: string | null,
  text: string | undefined,
  scrape: (url: string) => Promise<T>
): Promise<SourceResult<T>> {
  if (text && text.trim().length >= MIN_PASTE_CHARS) {
    return { status: "pasted", data: { source: "manual", url, text: text.trim() } };
  }
  if (!url) return { status: "failed", error: `No valid ${platform} URL or pasted text provided` };
  try {
    return { status: "scraped", data: await scrape(url) };
  } catch (e) {
    console.error(`[ingest] ${platform} scrape failed for ${url}:`, e);
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

// Loose name match between the LinkedIn name and the Instagram display name:
// true if they share a name token of 3+ letters (or one contains the other).
// Only "clearly different" names trigger the warning; an empty or
// non-alphabetic Instagram name (emoji, brand) is treated as unknown.
function namesMayMatch(a: string, b: string) {
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3);
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return true;
  const ja = ta.join("");
  const jb = tb.join("");
  return ta.some((t) => tb.includes(t)) || ja.includes(jb) || jb.includes(ja);
}

const sourceStatus = (r: SourceResult<unknown>) =>
  r.status === "failed" ? { status: r.status, error: r.error } : { status: r.status };

// POST /api/ingest
// Body: { opted_in: true, name?, linkedin_url, instagram_url, linkedin_text?, instagram_text?,
//         looking_for?, age?, age_range_min?, age_range_max?, city? }
// opted_in must be true (the person consents to joining the dating pool).
// Both platforms are required. If a scrape fails, responds 422 with
// `needs_manual` listing the platforms to paste text for; resend the same
// body plus `<platform>_text` (successful scrapes are cached, not re-run).
export async function POST(request: Request) {
  let body: IngestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  if (body.opted_in !== true) {
    return Response.json(
      { error: "The person must consent to joining the dating pool (opted_in: true) before their profiles are read." },
      { status: 400 }
    );
  }
  const prefs = parsePreferences(body as Record<string, unknown>);
  if ("error" in prefs) return Response.json({ error: prefs.error }, { status: 400 });

  const limited = await rateLimit(request, "ingest");
  if (limited) return limited;

  const linkedinUrl = body.linkedin_url ? normalizeLinkedInUrl(body.linkedin_url) : null;
  const igUser = body.instagram_url ? instagramUsername(body.instagram_url) : null;
  if (body.linkedin_url && !linkedinUrl && !body.linkedin_text) {
    return Response.json({ error: "linkedin_url must look like https://www.linkedin.com/in/<handle>" }, { status: 400 });
  }
  if (body.instagram_url && !igUser && !body.instagram_text) {
    return Response.json({ error: "instagram_url must be an Instagram profile URL or @handle" }, { status: 400 });
  }

  // Hard cap on pool size, checked before any scraping. Re-ingesting an
  // existing LinkedIn (an update) is always allowed.
  const db = supabaseAdmin();
  const { count: profileCount } = await db.from("profiles").select("id", { count: "exact", head: true });
  if ((profileCount ?? 0) >= MAX_PROFILES) {
    const isUpdate =
      linkedinUrl && (await db.from("profiles").select("id").eq("linkedin_url", linkedinUrl).maybeSingle()).data;
    if (!isUpdate) {
      return Response.json(
        { error: `The dating pool is full (${MAX_PROFILES} profiles). No new profiles can be added right now.` },
        { status: 403 }
      );
    }
  }

  const [linkedin, instagram] = await Promise.all([
    resolveSource<LinkedInData>("linkedin", linkedinUrl, body.linkedin_text, scrapeLinkedIn),
    resolveSource<InstagramData>(
      "instagram",
      igUser ? `https://www.instagram.com/${igUser}` : null,
      body.instagram_text,
      () => scrapeInstagram(igUser!)
    ),
  ]);
  const sources = { linkedin: sourceStatus(linkedin), instagram: sourceStatus(instagram) };

  if (linkedin.status === "failed" || instagram.status === "failed") {
    const needs_manual = (["linkedin", "instagram"] as const).filter((p) => sources[p].status === "failed");
    return Response.json(
      {
        error: `Could not get ${needs_manual.join(" and ")} data. Paste the profile text as ${needs_manual
          .map((p) => `${p}_text`)
          .join(" / ")} and retry.`,
        needs_manual,
        sources,
      },
      { status: 422 }
    );
  }

  // Identity check: a scraped LinkedIn and Instagram that clearly belong to
  // different people get a 409 the UI shows; resend with confirm_identity.
  if (
    !body.confirm_identity &&
    linkedin.data.source === "apify" &&
    instagram.data.source === "apify" &&
    linkedin.data.name &&
    instagram.data.name &&
    !namesMayMatch(linkedin.data.name, instagram.data.name)
  ) {
    return Response.json(
      {
        error: "These may not be the same person",
        identity_mismatch: { linkedin_name: linkedin.data.name, instagram_name: instagram.data.name },
        sources,
      },
      { status: 409 }
    );
  }

  const name =
    body.name?.trim() ||
    (linkedin.data.source === "apify" ? linkedin.data.name : null) ||
    (instagram.data.source === "apify" ? instagram.data.name : null);
  if (!name) {
    return Response.json({ error: "name is required when both sources are pasted text", sources }, { status: 400 });
  }

  const sections = [...linkedinSections(linkedin.data), ...instagramSections(instagram.data)];
  if (sections.length === 0) {
    return Response.json({ error: "Both profiles are empty; paste some profile text", sources }, { status: 422 });
  }

  let persona;
  try {
    persona = await extractPersona(name, sections);
  } catch (e) {
    console.error("[ingest] persona extraction failed:", e);
    return Response.json(
      { error: `Persona extraction failed: ${e instanceof Error ? e.message : e}`, sources },
      { status: 502 }
    );
  }

  const row = {
    name,
    linkedin_url: linkedin.data.url,
    instagram_url: instagram.data.url,
    raw_linkedin_data: linkedin.data,
    raw_instagram_data: instagram.data,
    ...persona,
    opted_in: true,
    ...prefs.value,
  };

  // Re-ingesting the same LinkedIn updates that profile (unique linkedin_url)
  // instead of creating a duplicate.
  const existing = row.linkedin_url
    ? (await db.from("profiles").select("id").eq("linkedin_url", row.linkedin_url).maybeSingle()).data
    : null;
  const { data: profile, error } = existing
    ? await db.from("profiles").update(row).eq("id", existing.id).select().single()
    : await db.from("profiles").insert(row).select().single();

  if (error) {
    console.error("[ingest] save failed:", error);
    return Response.json({ error: `Database save failed: ${error.message}`, sources }, { status: 500 });
  }

  return Response.json({ profile, sources, updated: !!existing }, { status: existing ? 200 : 201 });
}
