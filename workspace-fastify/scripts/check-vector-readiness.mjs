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
    max: 1
  });
}

async function main() {
  const pool = getPool();

  try {
    const extension = await pool.query(`
      select extname, extversion
      from pg_extension
      where extname = 'vector'
    `);

    const coverage = await pool.query(`
      select
        count(*)::int as total_rows,
        count(*) filter (where embedding_vec is not null)::int as vector_rows,
        count(*) filter (where embedding_values is not null)::int as embedding_value_rows
      from ai_core.scc_chunk_embeddings
    `);

    const models = await pool.query(`
      select embedding_model, embedding_dim, count(*)::int as row_count
      from ai_core.scc_chunk_embeddings
      group by embedding_model, embedding_dim
      order by row_count desc, embedding_model asc
    `);

    const indexes = await pool.query(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'ai_core'
        and tablename = 'scc_chunk_embeddings'
      order by indexname
    `);

    console.log(JSON.stringify({
      vectorExtension: extension.rows[0] ?? null,
      coverage: coverage.rows[0] ?? null,
      models: models.rows,
      indexes: indexes.rows
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] vector readiness check failed");
  console.error(error);
  process.exitCode = 1;
});
