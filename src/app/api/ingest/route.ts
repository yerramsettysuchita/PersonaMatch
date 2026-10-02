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

const sourceStatus = (r: SourceResult<unknown>) =>
  r.status === "failed" ? { status: r.status, error: r.error } : { status: r.status };

// POST /api/ingest
// Body: { name?, linkedin_url, instagram_url, linkedin_text?, instagram_text? }
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

  const linkedinUrl = body.linkedin_url ? normalizeLinkedInUrl(body.linkedin_url) : null;
  const igUser = body.instagram_url ? instagramUsername(body.instagram_url) : null;
  if (body.linkedin_url && !linkedinUrl && !body.linkedin_text) {
    return Response.json({ error: "linkedin_url must look like https://www.linkedin.com/in/<handle>" }, { status: 400 });
  }
  if (body.instagram_url && !igUser && !body.instagram_text) {
    return Response.json({ error: "instagram_url must be an Instagram profile URL or @handle" }, { status: 400 });
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

  const { data: profile, error } = await supabaseAdmin()
    .from("profiles")
    .insert({
      name,
      linkedin_url: linkedin.data.url,
      instagram_url: instagram.data.url,
      raw_linkedin_data: linkedin.data,
      raw_instagram_data: instagram.data,
      ...persona,
    })
    .select()
    .single();

  if (error) {
    console.error("[ingest] insert failed:", error);
    return Response.json({ error: `Database insert failed: ${error.message}`, sources }, { status: 500 });
  }

  return Response.json({ profile, sources }, { status: 201 });
}
