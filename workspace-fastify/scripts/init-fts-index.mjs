#!/usr/bin/env node
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

function parsePort(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getPool() {
  return new Pool({
    host: process.env.VECTOR_DB_HOST ?? "localhost",
    port: parsePort(process.env.VECTOR_DB_PORT, 5432),
    database: process.env.VECTOR_DB_NAME ?? "ai2",
    user: process.env.VECTOR_DB_USER,
    password: process.env.VECTOR_DB_PASSWORD,
    ssl: process.env.VECTOR_DB_SSL === "true",
  });
}

// 'simple' dictionary: whitespace tokenization, no stemming.
// Suitable for Korean since all relevant terms remain intact.
const sqlStatements = [
  {
    label: "idx_scc_request_fts (title + context)",
    sql: `
      create index if not exists idx_scc_request_fts
        on public.scc_request
        using gin(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(context,'')));
    `,
  },
  {
    label: "idx_scc_reply_fts (reply)",
    sql: `
      create index if not exists idx_scc_reply_fts
        on public.scc_reply
        using gin(to_tsvector('simple', coalesce(reply,'')));
    `,
  },
];

async function main() {
  const pool = getPool();
  console.log("[init-fts-index] Connecting to DB...");

  try {
    for (const { label, sql } of sqlStatements) {
      console.log(`[running] ${label}`);
      await pool.query(sql);
      console.log(`[ok]      ${label}`);
    }
    console.log("\n[init-fts-index] Done. FTS GIN indexes are ready.");
    console.log("  - public.scc_request: idx_scc_request_fts");
    console.log("  - public.scc_reply:   idx_scc_reply_fts");
  } catch (err) {
    console.error("[error]", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
