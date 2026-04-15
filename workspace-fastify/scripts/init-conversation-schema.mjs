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
  create table if not exists ai_core.conversation_session (
    session_id uuid primary key,
    client_session_id text null,
    user_key text null,
    title text null,
    status text not null default 'active',
    message_count integer not null default 0,
    last_message_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  `,
  `
  create table if not exists ai_core.conversation_message (
    message_id uuid primary key,
    session_id uuid not null references ai_core.conversation_session(session_id) on delete cascade,
    turn_index integer not null,
    role text not null check (role in ('user', 'assistant', 'system')),
    content text not null,
    status text null,
    answer_source text null,
    retrieval_mode text null,
    confidence numeric(5,4) null,
    best_require_id uuid null,
    best_scc_id bigint null,
    similar_issue_url text null,
    log_uuid uuid null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  `,
  `comment on table ai_core.conversation_session is '대화 세션 저장소 - 사용자별/세션별 채팅방 메타데이터';`,
  `comment on table ai_core.conversation_message is '대화 메시지 저장소 - user/assistant 턴 단위 메시지';`,
  `create unique index if not exists idx_conversation_session_client on ai_core.conversation_session (client_session_id) where client_session_id is not null;`,
  `create index if not exists idx_conversation_session_user_updated on ai_core.conversation_session (user_key, updated_at desc) where user_key is not null;`,
  `create index if not exists idx_conversation_session_updated on ai_core.conversation_session (updated_at desc);`,
  `create unique index if not exists idx_conversation_message_session_turn on ai_core.conversation_message (session_id, turn_index);`,
  `create index if not exists idx_conversation_message_session_created on ai_core.conversation_message (session_id, created_at asc);`,
  `create index if not exists idx_conversation_message_log_uuid on ai_core.conversation_message (log_uuid) where log_uuid is not null;`
];

async function main() {
  const pool = getPool();
  console.log("[init-conversation-schema] Connecting to DB...");

  try {
    for (const sql of sqlStatements) {
      await pool.query(sql);
      const preview = sql.trim().slice(0, 80).replace(/\s+/g, " ");
      console.log(`[ok] ${preview}...`);
    }
    console.log("\n[init-conversation-schema] Done. conversation tables are ready.");
  } catch (error) {
    console.error("[error]", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
