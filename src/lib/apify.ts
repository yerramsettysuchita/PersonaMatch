/* eslint-disable @typescript-eslint/no-explicit-any -- Apify actor output is untyped third-party JSON, normalized below */
import { ApifyClient } from "apify-client";

const LINKEDIN_ACTOR = "harvestapi/linkedin-profile-scraper";
const INSTAGRAM_ACTOR = "apify/instagram-profile-scraper";
const RUN_TIMEOUT_SECS = 120;
const MAX_POSTS = 12;

export type Platform = "linkedin" | "instagram";

export type LinkedInData = {
  source: "apify";
  url: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  experience: {
    position: string | null;
    company: string | null;
    duration: string | null;
    description: string | null;
  }[];
  education: { school: string | null; degree: string | null; field: string | null; period: string | null }[];
  skills: string[];
  volunteering: string[];
  causes: string[];
  following: string[];
};

export type InstagramData = {
  source: "apify";
  url: string;
  username: string;
  name: string | null;
  bio: string | null;
  isPrivate: boolean;
  posts: {
    url: string;
    type: string | null;
    timestamp: string | null;
    caption: string;
    hashtags: string[];
    location: string | null;
    alt: string | null;
  }[];
};

export type PastedData = { source: "manual"; url: string | null; text: string };

// One labeled chunk of profile text. The LLM must cite `label` as evidence.
export type Section = { label: string; text: string };

// ---------- URL helpers ----------

export function normalizeLinkedInUrl(input: string): string | null {
  const m = input.trim().match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1])}` : null;
}

export function instagramUsername(input: string): string | null {
  const s = input.trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m && !["p", "reel", "reels", "stories", "explore"].includes(m[1].toLowerCase())) return m[1];
  const handle = s.replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

// ---------- Scrapers ----------

// Successful scrapes are cached per server process, so retrying an ingest
// (e.g. after pasting text for the platform that failed) doesn't pay twice.
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function client() {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN is not set");
  return new ApifyClient({ token });
}

async function runActor(actor: string, input: Record<string, unknown>) {
  const apify = client();
  const run = await apify
    .actor(actor)
    .call(input, { timeout: RUN_TIMEOUT_SECS, waitSecs: RUN_TIMEOUT_SECS + 30, maxItems: 1, log: null });
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify actor ${actor} finished with status ${run.status}`);
  }
  const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
  return items[0] as Record<string, any> | undefined;
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data as T;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function scrapeLinkedIn(url: string): Promise<LinkedInData> {
  return cached(`li:${url}`, async () => {
    const p = await runActor(LINKEDIN_ACTOR, {
      profileScraperMode: "Profile details no email ($4 per 1k)",
      queries: [url],
    });
    if (!p || (!p.headline && !p.firstName)) {
      throw new Error("LinkedIn profile not found or not public");
    }
    return {
      source: "apify",
      url,
      name: str([p.firstName, p.lastName].filter(Boolean).join(" ")),
      headline: str(p.headline),
      location: str(p.location?.linkedinText),
      about: str(p.about),
      experience: (p.experience ?? []).map((e: any) => ({
        position: str(e.position),
        company: str(e.companyName),
        duration: str([e.startDate?.text, e.endDate?.text].filter(Boolean).join(" – ")) ?? str(e.duration),
        description: str(e.description),
      })),
      education: (p.education ?? []).map((e: any) => ({
        school: str(e.schoolName),
        degree: str(e.degree),
        field: str(e.fieldOfStudy),
        period: str(e.period),
      })),
      skills: [...(p.skills ?? []), ...(p.topSkills ?? [])]
        .map((s: any) => str(typeof s === "string" ? s : s?.name))
        .filter((s): s is string => !!s),
      volunteering: (p.volunteering ?? [])
        .map((v: any) => str([v.role, v.organizationName ?? v.companyName, v.cause].filter(Boolean).join(" · ")))
        .filter((s: string | null): s is string => !!s),
      causes: (p.causes ?? []).map((c: any) => str(typeof c === "string" ? c : c?.name)).filter(Boolean),
      following: (p.interests ?? [])
        .flatMap((g: any) => (g.elements ?? []).map((el: any) => str(el.title)))
        .filter(Boolean)
        .slice(0, 15),
    };
  });
}

export function scrapeInstagram(username: string): Promise<InstagramData> {
  return cached(`ig:${username.toLowerCase()}`, async () => {
    const p = await runActor(INSTAGRAM_ACTOR, { usernames: [username] });
    if (!p || p.error || !p.username) {
      throw new Error(p?.errorDescription ?? p?.error ?? "Instagram profile not found");
    }
    return {
      source: "apify",
      url: `https://www.instagram.com/${p.username}`,
      username: p.username,
      name: str(p.fullName),
      bio: str(p.biography),
      isPrivate: !!p.private,
      posts: (p.latestPosts ?? []).slice(0, MAX_POSTS).map((post: any) => ({
        url: post.url,
        type: str(post.type),
        timestamp: str(post.timestamp),
        caption: str(post.caption) ?? "",
        hashtags: post.hashtags ?? [],
        location: str(post.locationName),
        alt: str(post.alt),
      })),
    };
  });
}

// ---------- Labeled sections for the LLM ----------

export function linkedinSections(d: LinkedInData | PastedData): Section[] {
  if (d.source === "manual") return pastedSections("linkedin", d.text);
  const out: Section[] = [];
  if (d.headline) out.push({ label: "linkedin:headline", text: d.headline });
  if (d.location) out.push({ label: "linkedin:location", text: d.location });
  if (d.about) out.push({ label: "linkedin:about", text: d.about });
  d.experience.forEach((e, i) => {
    const text = [e.position, e.company && `at ${e.company}`, e.duration && `(${e.duration})`, e.description]
      .filter(Boolean)
      .join(" ");
    if (text) out.push({ label: `linkedin:experience#${i + 1}`, text });
  });
  d.education.forEach((e, i) => {
    const text = [e.degree, e.field, e.school, e.period && `(${e.period})`].filter(Boolean).join(", ");
    if (text) out.push({ label: `linkedin:education#${i + 1}`, text });
  });
  if (d.skills.length) out.push({ label: "linkedin:skills", text: d.skills.join(", ") });
  d.volunteering.forEach((v, i) => out.push({ label: `linkedin:volunteering#${i + 1}`, text: v }));
  if (d.causes.length) out.push({ label: "linkedin:causes", text: d.causes.join(", ") });
  if (d.following.length) out.push({ label: "linkedin:follows", text: d.following.join(", ") });
  return out;
}

export function instagramSections(d: InstagramData | PastedData): Section[] {
  if (d.source === "manual") return pastedSections("instagram", d.text);
  const out: Section[] = [];
  if (d.bio) out.push({ label: "instagram:bio", text: d.bio });
  d.posts.forEach((p, i) => {
    const meta = [p.timestamp?.slice(0, 10), p.type, p.location && `at ${p.location}`].filter(Boolean).join(", ");
    const text = [p.caption, p.alt && `[image: ${p.alt}]`].filter(Boolean).join(" ");
    if (text) out.push({ label: `instagram:post#${i + 1}`, text: `(${meta}) ${text}` });
  });
  return out;
}

// Pasted text is split into paragraphs so evidence can point at a specific one.
function pastedSections(platform: Platform, text: string): Section[] {
  return text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => ({ label: `${platform}:pasted#${i + 1}`, text: t }));
}
