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

async function main() {
  const pool = getPool();
  try {
    await pool.query("create schema if not exists ai_core");
    await pool.query("create extension if not exists vector");

    await pool.query(`
      create table if not exists ai_core.embedding_ingest_state (
        state_key text primary key,
        last_source_ingested_at timestamptz,
        last_run_at timestamptz,
        last_status text not null default 'never',
        last_message text,
        updated_at timestamptz not null default now()
      )
    `);

    await pool.query(`
      create table if not exists ai_core.manual_documents (
        document_id uuid primary key,
        audience text not null check (audience in ('user', 'manager')),
        product text not null,
        title text not null,
        version text,
        file_ext text not null,
        source_path text not null unique,
        source_rel_path text not null,
        file_size bigint not null,
        file_mtime timestamptz not null,
        text_hash text not null,
        extracted_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await pool.query(`
      create table if not exists ai_core.manual_chunks (
        chunk_id uuid primary key,
        document_id uuid not null references ai_core.manual_documents(document_id) on delete cascade,
        audience text not null check (audience in ('user', 'manager')),
        product text not null,
        chunk_seq int not null,
        chunk_type text not null default 'manual',
        section_title text,
        chunk_text text not null,
        text_hash text not null,
        token_estimate int not null default 0,
        updated_at timestamptz not null default now(),
        unique (document_id, chunk_seq)
      )
    `);

    await pool.query(`
      create table if not exists ai_core.manual_chunk_embeddings (
        chunk_id uuid not null references ai_core.manual_chunks(chunk_id) on delete cascade,
        document_id uuid not null references ai_core.manual_documents(document_id) on delete cascade,
        audience text not null check (audience in ('user', 'manager')),
        product text not null,
        embedding_model text not null,
        embedding_dim int not null,
        embedding_values float8[] not null,
        embedding_vec vector,
        embedding_norm float8 not null,
        text_hash text not null,
        embedded_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (chunk_id, embedding_model)
      )
    `);

    await pool.query(`
      create index if not exists idx_manual_documents_audience_product
        on ai_core.manual_documents (audience, product)
    `);
    await pool.query(`
      create index if not exists idx_manual_chunks_document_seq
        on ai_core.manual_chunks (document_id, chunk_seq)
    `);
    await pool.query(`
      create index if not exists idx_manual_chunks_audience_product
        on ai_core.manual_chunks (audience, product)
    `);
    await pool.query(`
      create index if not exists idx_manual_chunk_embeddings_model_dim
        on ai_core.manual_chunk_embeddings (embedding_model, embedding_dim)
    `);
    await pool.query(`
      create index if not exists idx_manual_chunk_embeddings_document
        on ai_core.manual_chunk_embeddings (document_id)
    `);

    console.log("[ok] manual schema initialized");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] manual schema initialization failed");
  console.error(error);
  process.exitCode = 1;
});
