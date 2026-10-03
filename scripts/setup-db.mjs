// Applies supabase/schema.sql to the Supabase Postgres database.
// Usage: npm run db:setup
import { readFileSync } from "node:fs";
import pg from "pg";

process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!url || !password) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_PASSWORD must be set in .env.local");
  process.exit(1);
}
const ref = new URL(url).hostname.split(".")[0];

const client = new pg.Client({
  host: `db.${ref}.supabase.co`,
  port: 5432,
  user: "postgres",
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(readFileSync("supabase/schema.sql", "utf8"));
  // Make PostgREST (supabase-js) pick up the new tables immediately.
  await client.query("notify pgrst, 'reload schema'");
  const { rows } = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name in ('profiles', 'dates', 'rankings', 'scrape_cache', 'rate_limits')
     order by table_name`
  );
  console.log("Tables ready:", rows.map((r) => r.table_name).join(", "));
} finally {
  await client.end();
}
