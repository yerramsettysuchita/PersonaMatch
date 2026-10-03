import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase";

export const LIMITS = {
  // Each ingest can cost Apify credit and a Gemini call.
  ingest: { limit: 5, windowMs: 60 * 60_000 },
  // One "Run Dates" click makes up to 6 /api/rank calls (see RunDatesButton),
  // so this allows several full runs per hour.
  rank: { limit: 30, windowMs: 60 * 60_000 },
} as const;

export const MAX_PROFILES = 60;

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

const isLoopback = (ip: string) => ip === "unknown" || ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1";

// Per-IP fixed-window rate limit backed by the rate_limits table. Returns a
// 429 Response when over the limit, otherwise records the hit and returns null.
// Local scripts (seed, eval) calling the dev server from loopback are exempt.
export async function rateLimit(request: Request, bucket: keyof typeof LIMITS): Promise<Response | null> {
  const ip = clientIp(request);
  if (process.env.NODE_ENV !== "production" && isLoopback(ip)) return null;

  const { limit, windowMs } = LIMITS[bucket];
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const since = new Date(Date.now() - windowMs).toISOString();
  const db = supabaseAdmin();

  const { data: hits, error } = await db
    .from("rate_limits")
    .select("created_at")
    .eq("bucket", bucket)
    .eq("ip_hash", ipHash)
    .gt("created_at", since)
    .order("created_at", { ascending: true });
  if (error) {
    // Fail open: a rate-limit outage shouldn't take the app down.
    console.error("[rate-limit] lookup failed:", error.message);
    return null;
  }

  if (hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((new Date(hits[0].created_at).getTime() + windowMs - Date.now()) / 1000));
    const minutes = Math.ceil(retryAfterSec / 60);
    return Response.json(
      {
        error: `Too many requests: ${bucket} is limited to ${limit} per hour per person. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    );
  }

  await db.from("rate_limits").insert({ bucket, ip_hash: ipHash });
  // Housekeeping: drop rows older than a day.
  await db.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
  return null;
}
