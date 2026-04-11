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
    ssl: process.env.VECTOR_DB_SSL === "true"
  });
}

const sqlStatements = [
  `create schema if not exists ai_core;`,
  `
  create table if not exists ai_core.query_log (
    id              bigserial primary key,
    log_uuid        uuid not null default gen_random_uuid(),
    query           text not null,
    retrieval_scope text,
    confidence      numeric(5,4),
    best_require_id uuid,
    best_scc_id     bigint,
    chunk_type      text,
    vector_used     boolean,
    retrieval_mode  text,
    answer_source   text,
    llm_used        boolean,
    llm_skipped     boolean,
    llm_skip_reason text,
    is_no_match     boolean not null default false,
    is_failure      boolean not null default false,
    failure_reason  text,
    rule_ms         integer,
    embedding_ms    integer,
    vector_ms       integer,
    rerank_ms       integer,
    retrieval_ms    integer,
    llm_ms          integer,
    total_ms        integer,
    user_feedback   text check (user_feedback in ('up', 'down')),
    created_at      timestamptz not null default now()
  );
  `,
  `alter table ai_core.query_log add column if not exists log_uuid uuid default gen_random_uuid();`,
  `alter table ai_core.query_log add column if not exists is_failure boolean not null default false;`,
  `alter table ai_core.query_log add column if not exists failure_reason text;`,
  `alter table ai_core.query_log add column if not exists user_feedback text check (user_feedback in ('up', 'down'));`,
  `alter table ai_core.query_log alter column log_uuid set default gen_random_uuid();`,
  `update ai_core.query_log set log_uuid = gen_random_uuid() where log_uuid is null;`,
  `alter table ai_core.query_log alter column log_uuid set not null;`,
  `comment on table ai_core.query_log is '챗봇 쿼리 로그 - 검색 품질 모니터링 및 실패 케이스 분석용';`,
  `create unique index if not exists idx_query_log_uuid on ai_core.query_log(log_uuid);`,
  `create index if not exists idx_query_log_created_at on ai_core.query_log (created_at desc);`,
  `create index if not exists idx_query_log_is_no_match on ai_core.query_log (is_no_match) where is_no_match = true;`,
  `create index if not exists idx_query_log_is_failure on ai_core.query_log (is_failure) where is_failure = true;`,
  `create index if not exists idx_query_log_confidence on ai_core.query_log (confidence);`,
  `create index if not exists idx_query_log_feedback on ai_core.query_log(user_feedback) where user_feedback is not null;`
];

async function main() {
  const pool = getPool();
  console.log("[init-query-log] Connecting to DB...");

  try {
    for (const sql of sqlStatements) {
      await pool.query(sql);
      const preview = sql.trim().slice(0, 80).replace(/\s+/g, " ");
      console.log(`[ok] ${preview}...`);
    }
    console.log("\n[init-query-log] Done. ai_core.query_log table is ready.");
  } catch (err) {
    console.error("[error]", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
