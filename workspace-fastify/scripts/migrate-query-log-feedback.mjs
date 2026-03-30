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
    host: process.env.VECTOR_DB_HOST ?? "DB_HOST_REMOVED",
    port: parsePort(process.env.VECTOR_DB_PORT, 5432),
    database: process.env.VECTOR_DB_NAME ?? "ai2",
    user: process.env.VECTOR_DB_USER ?? "novian",
    password: process.env.VECTOR_DB_PASSWORD ?? "REMOVED",
    ssl: process.env.VECTOR_DB_SSL === "true",
  });
}

const sqlStatements = [
  {
    label: "add log_uuid column",
    sql: `alter table ai_core.query_log
            add column if not exists log_uuid uuid default gen_random_uuid();`,
  },
  {
    label: "add user_feedback column",
    sql: `alter table ai_core.query_log
            add column if not exists user_feedback text
            check (user_feedback in ('up', 'down'));`,
  },
  {
    label: "unique index on log_uuid",
    sql: `create unique index if not exists idx_query_log_uuid
            on ai_core.query_log(log_uuid);`,
  },
  {
    label: "index on user_feedback",
    sql: `create index if not exists idx_query_log_feedback
            on ai_core.query_log(user_feedback)
            where user_feedback is not null;`,
  },
];

async function main() {
  const pool = getPool();
  console.log("[migrate-query-log-feedback] Connecting to DB...");
  try {
    for (const { label, sql } of sqlStatements) {
      console.log(`[running] ${label}`);
      await pool.query(sql);
      console.log(`[ok]      ${label}`);
    }
    console.log("\n[migrate-query-log-feedback] Done.");
  } catch (err) {
    console.error("[error]", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
