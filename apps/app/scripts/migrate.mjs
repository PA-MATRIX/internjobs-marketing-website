import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
});

try {
  await pool.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())");
  const migrationsDir = new URL("../db/migrations", import.meta.url);
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const existing = await pool.query("select version from schema_migrations where version = $1", [version]);
    if (existing.rows[0]) {
      console.log(`migration skipped: ${version}`);
      continue;
    }

    const sql = await readFile(join(migrationsDir.pathname, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [version]);
      await client.query("commit");
      console.log(`migration applied: ${version}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
