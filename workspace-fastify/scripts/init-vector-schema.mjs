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
    ssl: process.env.VECTOR_DB_SSL === "true"
  });
}

const sqlStatements = [
  `create schema if not exists ai_core;`,
  `
  create table if not exists ai_core.scc_chunk_embeddings (
    chunk_id uuid not null,
    scc_id bigint not null,
    require_id uuid not null,
    chunk_type text not null,
    chunk_text text not null,
    text_hash text not null,
    embedding_model text not null,
    embedding_dim integer not null,
    embedding_values float8[] not null,
    embedding_norm float8 not null,
    source_ingested_at timestamptz null,
    embedded_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (chunk_id, embedding_model)
  );
  `,
  `
  create table if not exists ai_core.embedding_ingest_state (
    state_key text primary key,
    last_source_ingested_at timestamptz null,
    last_run_at timestamptz null,
    last_status text not null default 'never',
    last_message text null,
    updated_at timestamptz not null default now()
  );
  `,
  `create index if not exists idx_scc_chunk_embeddings_require on ai_core.scc_chunk_embeddings (require_id);`,
  `create index if not exists idx_scc_chunk_embeddings_scc on ai_core.scc_chunk_embeddings (scc_id);`,
  `create index if not exists idx_scc_chunk_embeddings_chunk_type on ai_core.scc_chunk_embeddings (chunk_type);`,
  `create index if not exists idx_scc_chunk_embeddings_model on ai_core.scc_chunk_embeddings (embedding_model);`,
  `create index if not exists idx_scc_chunk_embeddings_embedded_at on ai_core.scc_chunk_embeddings (embedded_at desc);`,
  `
  create or replace view ai_core.v_scc_embedding_status as
  select
    embedding_model,
    count(*)::bigint as embedding_rows,
    count(distinct chunk_id)::bigint as embedded_chunks,
    max(embedded_at) as last_embedded_at,
    max(updated_at) as last_updated_at
  from ai_core.scc_chunk_embeddings
  group by embedding_model;
  `,
  `
  create or replace view ai_core.v_scc_embedding_coverage as
  with source_rows as (
    select count(*)::bigint as source_chunk_rows
    from ai_core.v_scc_chunk_preview
  ), embedding_rows as (
    select
      embedding_model,
      count(distinct chunk_id)::bigint as embedded_chunks
    from ai_core.scc_chunk_embeddings
    group by embedding_model
  )
  select
    e.embedding_model,
    s.source_chunk_rows,
    e.embedded_chunks,
    round((e.embedded_chunks::numeric / nullif(s.source_chunk_rows, 0)) * 100, 2) as coverage_pct
  from source_rows s
  join embedding_rows e on true;
  `
];

async function main() {
  const pool = getPool();

  try {
    const ext = await pool.query(`select count(*)::int as cnt from pg_extension where extname='vector'`);
    const hasVector = ext.rows[0].cnt > 0;
    if (ext.rows[0].cnt === 0) {
      console.log("[info] pgvector extension is not installed. using float8[] storage mode.");
    } else {
      console.log("[info] pgvector extension detected.");
    }

    for (const statement of sqlStatements) {
      await pool.query(statement);
    }

    if (hasVector) {
      await pool.query(`
        alter table ai_core.scc_chunk_embeddings
        add column if not exists embedding_vec vector
      `);
      console.log("[info] embedding_vec column ensured. run db:enable:pgvector for backfill/index.");
    }

    console.log("[ok] ai_core vector schema initialized");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] failed to initialize vector schema");
  console.error(error);
  process.exitCode = 1;
});
