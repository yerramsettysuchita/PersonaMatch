import { createDate, PERSONA_COLUMNS, type PersonaRow } from "@/lib/dates";
import { supabaseAdmin } from "@/lib/supabase";

// One Gemini call; usually 10-30s, up to ~145s if every fallback in generateJSON is used.
export const maxDuration = 150;

// POST /api/date
// Body: { person_a_id, person_b_id }
// Simulates a first date between two ingested profiles and stores it in `dates`.
export async function POST(request: Request) {
  let body: { person_a_id?: unknown; person_b_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const { person_a_id, person_b_id } = body;
  if (typeof person_a_id !== "string" || typeof person_b_id !== "string") {
    return Response.json({ error: "person_a_id and person_b_id are required strings" }, { status: 400 });
  }
  if (person_a_id === person_b_id) {
    return Response.json({ error: "person_a_id and person_b_id must be different people" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: people, error: fetchError } = await db
    .from("profiles")
    .select(PERSONA_COLUMNS)
    .in("id", [person_a_id, person_b_id])
    .returns<PersonaRow[]>();

  if (fetchError) {
    // Malformed UUIDs fail the query rather than matching nothing.
    if (fetchError.code === "22P02") {
      return Response.json({ error: "person_a_id and person_b_id must be valid UUIDs" }, { status: 400 });
    }
    console.error("[date] profile fetch failed:", fetchError);
    return Response.json({ error: `Database error: ${fetchError.message}` }, { status: 500 });
  }

  const a = people.find((p) => p.id === person_a_id);
  const b = people.find((p) => p.id === person_b_id);
  if (!a || !b) {
    const missing = [!a && person_a_id, !b && person_b_id].filter(Boolean);
    return Response.json({ error: "Profile not found", missing }, { status: 404 });
  }

  try {
    const date = await createDate(db, a, b);
    return Response.json({ date }, { status: 201 });
  } catch (e) {
    console.error("[date] failed:", e);
    return Response.json({ error: `Date simulation failed: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
