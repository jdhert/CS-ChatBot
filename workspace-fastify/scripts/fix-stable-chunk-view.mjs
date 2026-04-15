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

const sqlCreateStableUuidFn = `
create schema if not exists ai_core;

create or replace function ai_core.make_stable_chunk_uuid(
  p_require_id uuid,
  p_chunk_type text,
  p_chunk_seq integer,
  p_reply_state integer,
  p_chunk_text text
) returns uuid
language plpgsql
immutable
as $$
declare
  raw_key text;
  h text;
begin
  raw_key := concat_ws(
    '|',
    coalesce(p_require_id::text, ''),
    coalesce(p_chunk_type, ''),
    coalesce(p_chunk_seq::text, ''),
    coalesce(p_reply_state::text, ''),
    md5(coalesce(p_chunk_text, ''))
  );

  h := md5(raw_key);

  return (
    substr(h, 1, 8) || '-' ||
    substr(h, 9, 4) || '-' ||
    substr(h, 13, 4) || '-' ||
    substr(h, 17, 4) || '-' ||
    substr(h, 21, 12)
  )::uuid;
end;
$$;
`;

const sqlSnapshotBaseView = `
do $$
declare
  base_exists regclass;
  current_def text;
begin
  base_exists := to_regclass('ai_core.v_scc_chunk_preview_base');

  if base_exists is null then
    select pg_get_viewdef('ai_core.v_scc_chunk_preview'::regclass, true)
      into current_def;

    execute format(
      'create view ai_core.v_scc_chunk_preview_base as %s',
      current_def
    );
  end if;
end
$$;
`;

const sqlReplaceView = `
create or replace view ai_core.v_scc_chunk_preview as
select
  ai_core.make_stable_chunk_uuid(
    b.require_id,
    b.chunk_type,
    b.chunk_seq,
    b.reply_state,
    b.chunk_text
  ) as chunk_id,
  b.scc_id,
  b.require_id,
  b.chunk_type,
  b.chunk_seq,
  b.chunk_text,
  b.module_tag,
  b.reply_state,
  b.resolved_weight,
  b.ingested_at,
  b.state_weight,
  b.evidence_weight,
  b.text_len_score,
  b.tech_signal_score,
  b.specificity_score,
  b.closure_penalty_score,
  b.resolution_stage,
  b.feature_len
from ai_core.v_scc_chunk_preview_base b;
`;

const sqlCheckStability = `
with first_read as (
  select
    row_number() over (order by require_id, chunk_type, chunk_seq, md5(chunk_text)) as rn,
    chunk_id
  from ai_core.v_scc_chunk_preview
),
second_read as (
  select
    row_number() over (order by require_id, chunk_type, chunk_seq, md5(chunk_text)) as rn,
    chunk_id
  from ai_core.v_scc_chunk_preview
)
select
  count(*)::int as total_compared,
  count(*) filter (where f.chunk_id = s.chunk_id)::int as stable_matches
from first_read f
join second_read s on s.rn = f.rn;
`;

const sqlStaleEmbeddingCount = `
select count(*)::int as stale_rows
from ai_core.scc_chunk_embeddings e
where not exists (
  select 1
  from ai_core.v_scc_chunk_preview v
  where v.chunk_id = e.chunk_id
);
`;

const sqlDeleteStaleEmbeddings = `
delete from ai_core.scc_chunk_embeddings e
where not exists (
  select 1
  from ai_core.v_scc_chunk_preview v
  where v.chunk_id = e.chunk_id
);
`;

async function main() {
  const pool = getPool();

  try {
    await pool.query("begin");
    await pool.query(sqlCreateStableUuidFn);
    await pool.query(sqlSnapshotBaseView);
    await pool.query(sqlReplaceView);
    await pool.query("commit");

    const stable = await pool.query(sqlCheckStability);
    const staleBefore = await pool.query(sqlStaleEmbeddingCount);
    const removed = await pool.query(sqlDeleteStaleEmbeddings);
    const staleAfter = await pool.query(sqlStaleEmbeddingCount);

    console.log("[ok] v_scc_chunk_preview now uses deterministic chunk_id");
    console.log(
      `[check] stable_matches=${stable.rows[0].stable_matches}/${stable.rows[0].total_compared}`
    );
    console.log(`[cleanup] stale_before=${staleBefore.rows[0].stale_rows}`);
    console.log(`[cleanup] removed=${removed.rowCount ?? 0}`);
    console.log(`[cleanup] stale_after=${staleAfter.rows[0].stale_rows}`);
  } catch (error) {
    try {
      await pool.query("rollback");
    } catch {
      // no-op
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] failed to stabilize v_scc_chunk_preview");
  console.error(error);
  process.exitCode = 1;
});

