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

async function ensureVectorExtension(pool) {
  const available = await pool.query(
    `select installed_version from pg_available_extensions where name = 'vector'`
  );
  if (available.rowCount === 0) {
    throw new Error("pgvector extension package is not available on this server");
  }

  try {
    await pool.query(`create extension if not exists vector`);
  } catch (error) {
    throw new Error(
      `failed to create extension vector (permission or policy issue): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function ensureVectorColumn(pool) {
  await pool.query(`
    alter table ai_core.scc_chunk_embeddings
    add column if not exists embedding_vec vector
  `);
}

async function backfillEmbeddingVec(pool) {
  const result = await pool.query(`
    update ai_core.scc_chunk_embeddings
    set embedding_vec = ('[' || array_to_string(embedding_values, ',') || ']')::vector
    where embedding_vec is null
      and embedding_values is not null
  `);
  return result.rowCount ?? 0;
}

async function createIndexes(pool) {
  await pool.query(`
    create index if not exists idx_scc_chunk_embeddings_model_dim
    on ai_core.scc_chunk_embeddings (embedding_model, embedding_dim)
  `);
}

async function resolveIndexDimension(pool) {
  const envDim = Number.parseInt(process.env.PGVECTOR_INDEX_DIM ?? "", 10);
  if (Number.isFinite(envDim) && envDim > 0) {
    return envDim;
  }

  const result = await pool.query(`
    select embedding_dim, count(*)::bigint as cnt
    from ai_core.scc_chunk_embeddings
    where embedding_vec is not null
    group by embedding_dim
    order by cnt desc
    limit 1
  `);
  if (result.rowCount === 0) {
    return null;
  }
  const dim = Number.parseInt(String(result.rows[0].embedding_dim), 10);
  return Number.isFinite(dim) && dim > 0 ? dim : null;
}

async function createVectorIndex(pool, dim) {
  if (!dim) {
    return { created: false, method: null };
  }

  const hnswIndexName = `idx_scc_chunk_embeddings_vec_hnsw_d${dim}`;
  try {
    await pool.query(`
      create index if not exists ${hnswIndexName}
      on ai_core.scc_chunk_embeddings
      using hnsw (((embedding_vec::vector(${dim}))) vector_cosine_ops)
      where embedding_dim = ${dim}
    `);
    return { created: true, method: "hnsw" };
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code !== "54000") {
      throw error;
    }
  }

  const ivfIndexName = `idx_scc_chunk_embeddings_vec_ivfflat_d${dim}`;
  try {
    await pool.query(`
      create index if not exists ${ivfIndexName}
      on ai_core.scc_chunk_embeddings
      using ivfflat (((embedding_vec::vector(${dim}))) vector_cosine_ops)
      with (lists = 100)
      where embedding_dim = ${dim}
    `);
    return { created: true, method: "ivfflat" };
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "54000") {
      return { created: false, method: "none_dim_limit" };
    }
    throw error;
  }
}

async function checkVectorReady(pool) {
  const result = await pool.query(`
    select
      count(*)::int as total_rows,
      count(*) filter (where embedding_vec is not null)::int as vector_rows
    from ai_core.scc_chunk_embeddings
  `);
  return result.rows[0];
}

async function main() {
  const pool = getPool();

  try {
    await ensureVectorExtension(pool);
    await ensureVectorColumn(pool);
    const backfilled = await backfillEmbeddingVec(pool);
    await createIndexes(pool);
    const indexDim = await resolveIndexDimension(pool);
    const vectorIndex = await createVectorIndex(pool, indexDim);
    const ready = await checkVectorReady(pool);

    console.log("[ok] pgvector migration completed");
    console.log(`[info] backfilled_rows=${backfilled}`);
    console.log(
      `[info] vector_index_dim=${indexDim ?? "none"}, created=${vectorIndex.created}, method=${vectorIndex.method ?? "none"}`
    );
    console.log(
      `[info] vector_ready=${ready.vector_rows}/${ready.total_rows} (embedding_vec not null / total)`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] failed to enable pgvector search");
  console.error(error);
  process.exitCode = 1;
});
