#!/usr/bin/env node
import "dotenv/config";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const DEFAULT_PROVIDER = "openai";
const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";
const DEFAULT_GOOGLE_MODEL = "gemini-embedding-2-preview";
const DEFAULT_GOOGLE_OUTPUT_DIM = 768;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BATCHES = 50;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_GOOGLE_MIN_INTERVAL_MS = 700;
const DEFAULT_GOOGLE_MAX_RETRIES = 8;
const DEFAULT_PRIORITY_MODE = "chunk_id";

function parseIntSafe(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parsePort(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveProvider(raw) {
  const normalized = (raw ?? DEFAULT_PROVIDER).trim().toLowerCase();
  return normalized === "google" ? "google" : "openai";
}

function resolvePriorityMode(raw) {
  const normalized = (raw ?? DEFAULT_PRIORITY_MODE).trim().toLowerCase();
  return normalized === "answer_first" ? "answer_first" : "chunk_id";
}

function resolveModel(provider, raw) {
  if (raw && raw.trim().length > 0) {
    return raw.trim();
  }

  const common = process.env.EMBEDDING_MODEL?.trim();
  if (common) {
    return common;
  }

  if (provider === "google") {
    return process.env.GOOGLE_EMBEDDING_MODEL?.trim() ?? DEFAULT_GOOGLE_MODEL;
  }

  return process.env.OPENAI_EMBEDDING_MODEL?.trim() ?? DEFAULT_OPENAI_MODEL;
}

function modelTag(provider, model) {
  return `${provider}:${model}`;
}

function parseArgs(argv) {
  const provider = resolveProvider(process.env.EMBEDDING_PROVIDER);
  const args = {
    provider,
    modelRaw: undefined,
    batchSize: DEFAULT_BATCH_SIZE,
    maxBatches: DEFAULT_MAX_BATCHES,
    dryRun: false,
    priorityMode: resolvePriorityMode(process.env.EMBEDDING_PRIORITY_MODE)
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--provider" && argv[i + 1]) {
      args.provider = resolveProvider(argv[i + 1]);
      i += 1;
      continue;
    }
    if (current === "--model" && argv[i + 1]) {
      args.modelRaw = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--batch-size" && argv[i + 1]) {
      args.batchSize = parseIntSafe(argv[i + 1], DEFAULT_BATCH_SIZE);
      i += 1;
      continue;
    }
    if (current === "--max-batches" && argv[i + 1]) {
      args.maxBatches = parseIntSafe(argv[i + 1], DEFAULT_MAX_BATCHES);
      i += 1;
      continue;
    }
    if (current === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (current === "--priority-mode" && argv[i + 1]) {
      args.priorityMode = resolvePriorityMode(argv[i + 1]);
      i += 1;
    }
  }

  return {
    provider: args.provider,
    model: resolveModel(args.provider, args.modelRaw),
    batchSize: args.batchSize,
    maxBatches: args.maxBatches,
    dryRun: args.dryRun,
    priorityMode: args.priorityMode
  };
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

function toMd5(text) {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

function vectorNorm(values) {
  let sum = 0;
  for (const value of values) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers, bodyText) {
  const headerValue = headers?.get?.("retry-after");
  if (headerValue) {
    const seconds = Number.parseFloat(headerValue);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  const fromBody = bodyText.match(/retry in\s+([0-9.]+)s/i);
  if (fromBody?.[1]) {
    const seconds = Number.parseFloat(fromBody[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }
  }

  return null;
}

async function createOpenAiEmbeddings(inputs, model, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, input: inputs }),
      signal: controller.signal
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`openai embedding failed: ${response.status} ${bodyText}`);
    }

    const payload = await response.json();
    const list = payload?.data;

    if (!Array.isArray(list) || list.length !== inputs.length) {
      throw new Error("openai embedding response length mismatch");
    }

    return list
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  } finally {
    clearTimeout(timeout);
  }
}

async function createGoogleEmbeddingOne(text, model, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:embedContent?key=${encodeURIComponent(apiKey)}`;

    const outputDim = parseIntSafe(
      process.env.GOOGLE_EMBEDDING_OUTPUT_DIM,
      DEFAULT_GOOGLE_OUTPUT_DIM
    );

    const requestBody = {
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT"
    };

    if (outputDim > 0) {
      requestBody.outputDimensionality = outputDim;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      const bodyText = await response.text();
      const retryAfterMs = parseRetryAfterMs(response.headers, bodyText);

      if (response.status === 404) {
        throw new Error(
          `google embedding failed: 404 ${bodyText}\n` +
            `hint: try GOOGLE_EMBEDDING_MODEL=gemini-embedding-001 ` +
            `or check supported models via /v1beta/models`
        );
      }

      const error = new Error(`google embedding failed: ${response.status} ${bodyText}`);
      error.status = response.status;
      error.retryAfterMs = retryAfterMs;
      throw error;
    }

    const payload = await response.json();
    const values = payload?.embedding?.values ?? payload?.embeddings?.[0]?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("google embedding response missing values");
    }

    return values;
  } finally {
    clearTimeout(timeout);
  }
}

async function createGoogleEmbeddingWithRetry(text, model, apiKey, timeoutMs) {
  const minIntervalMs = parseIntSafe(
    process.env.GOOGLE_EMBEDDING_MIN_INTERVAL_MS,
    DEFAULT_GOOGLE_MIN_INTERVAL_MS
  );
  const maxRetries = parseIntSafe(
    process.env.GOOGLE_EMBEDDING_MAX_RETRIES,
    DEFAULT_GOOGLE_MAX_RETRIES
  );

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      if (minIntervalMs > 0 && attempt === 0) {
        await sleep(minIntervalMs);
      }
      return await createGoogleEmbeddingOne(text, model, apiKey, timeoutMs);
    } catch (error) {
      const status = Number(error?.status ?? 0);
      const retryAfterMsRaw = Number(error?.retryAfterMs ?? 0);
      const retryAfterMs =
        Number.isFinite(retryAfterMsRaw) && retryAfterMsRaw > 0
          ? retryAfterMsRaw
          : Math.min(60000, 1500 * (attempt + 1));
      const retryable = status === 429 || status >= 500;

      if (!retryable || attempt >= maxRetries) {
        throw error;
      }

      console.warn(
        `[retry] google embedding status=${status}, attempt=${attempt + 1}/${maxRetries}, waitMs=${retryAfterMs}`
      );
      await sleep(retryAfterMs);
      attempt += 1;
    }
  }

  throw new Error("google embedding retry exhausted");
}

async function createGoogleEmbeddings(inputs, model, apiKey, timeoutMs) {
  const output = [];
  for (const text of inputs) {
    const emb = await createGoogleEmbeddingWithRetry(text, model, apiKey, timeoutMs);
    output.push(emb);
  }
  return output;
}

async function createEmbeddings(inputs, provider, model, apiKey, timeoutMs) {
  if (provider === "google") {
    return createGoogleEmbeddings(inputs, model, apiKey, timeoutMs);
  }
  return createOpenAiEmbeddings(inputs, model, apiKey, timeoutMs);
}

function resolveOrderByClause(priorityMode) {
  if (priorityMode === "answer_first") {
    return `
      order by
        case
          when e.chunk_id is null then 0
          else 1
        end,
        case v.chunk_type
          when 'qa_pair' then 0
          when 'resolution' then 1
          when 'issue' then 2
          when 'action' then 3
          else 9
        end,
        v.chunk_id
    `;
  }

  return `
    order by v.chunk_id
  `;
}

async function fetchCandidateRows(pool, modelTagValue, batchSize, priorityMode) {
  const orderByClause = resolveOrderByClause(priorityMode);
  const sql = `
    select
      v.chunk_id::text as chunk_id,
      v.scc_id::text as scc_id,
      v.require_id::text as require_id,
      v.chunk_type,
      v.chunk_text
    from ai_core.v_scc_chunk_preview v
    left join ai_core.scc_chunk_embeddings e
      on e.chunk_id = v.chunk_id
      and e.embedding_model = $1
    where char_length(coalesce(v.chunk_text, '')) > 0
      and v.chunk_type in ('issue', 'action', 'resolution', 'qa_pair')
      and (
        e.chunk_id is null
        or e.text_hash is distinct from md5(v.chunk_text)
      )
    ${orderByClause}
    limit $2
  `;

  const result = await pool.query(sql, [modelTagValue, batchSize]);
  return result.rows;
}

async function hasEmbeddingVecColumn(pool) {
  const result = await pool.query(
    `
    select count(*)::int as cnt
    from information_schema.columns
    where table_schema = 'ai_core'
      and table_name = 'scc_chunk_embeddings'
      and column_name = 'embedding_vec'
    `
  );
  return result.rows[0]?.cnt > 0;
}

async function upsertEmbedding(pool, row, modelTagValue, embedding, useEmbeddingVecColumn) {
  const textHash = toMd5(row.chunk_text);
  const vectorValueSql = useEmbeddingVecColumn
    ? "('[' || array_to_string($9::float8[], ',') || ']')::vector"
    : "";
  const vectorUpdateSql = useEmbeddingVecColumn ? "embedding_vec = excluded.embedding_vec" : "";

  const sql = `
    insert into ai_core.scc_chunk_embeddings (
      chunk_id,
      scc_id,
      require_id,
      chunk_type,
      chunk_text,
      text_hash,
      embedding_model,
      embedding_dim,
      embedding_values,
      ${useEmbeddingVecColumn ? "embedding_vec," : ""}
      embedding_norm,
      source_ingested_at,
      embedded_at,
      updated_at
    )
    values (
      $1::uuid,
      $2::bigint,
      $3::uuid,
      $4::text,
      $5::text,
      $6::text,
      $7::text,
      $8::int4,
      $9::float8[],
      ${useEmbeddingVecColumn ? `${vectorValueSql},` : ""}
      $10::float8,
      $11::timestamptz,
      now(),
      now()
    )
    on conflict (chunk_id, embedding_model)
    do update set
      scc_id = excluded.scc_id,
      require_id = excluded.require_id,
      chunk_type = excluded.chunk_type,
      chunk_text = excluded.chunk_text,
      text_hash = excluded.text_hash,
      embedding_dim = excluded.embedding_dim,
      embedding_values = excluded.embedding_values,
      ${useEmbeddingVecColumn ? `${vectorUpdateSql},` : ""}
      embedding_norm = excluded.embedding_norm,
      source_ingested_at = excluded.source_ingested_at,
      embedded_at = now(),
      updated_at = now()
    returning (xmax = 0) as inserted
  `;

  const result = await pool.query(sql, [
    row.chunk_id,
    row.scc_id,
    row.require_id,
    row.chunk_type,
    row.chunk_text,
    textHash,
    modelTagValue,
    embedding.length,
    embedding,
    vectorNorm(embedding),
    row.ingested_at ?? null
  ]);

  return result.rows[0]?.inserted === true;
}

async function upsertState(pool, stateKey, status, message) {
  const sql = `
    insert into ai_core.embedding_ingest_state (
      state_key,
      last_source_ingested_at,
      last_run_at,
      last_status,
      last_message,
      updated_at
    )
    values (
      $1,
      $2,
      now(),
      $3,
      $4,
      now()
    )
    on conflict (state_key)
    do update set
      last_source_ingested_at = coalesce(excluded.last_source_ingested_at, ai_core.embedding_ingest_state.last_source_ingested_at),
      last_run_at = now(),
      last_status = excluded.last_status,
      last_message = excluded.last_message,
      updated_at = now()
  `;

  await pool.query(sql, [stateKey, null, status, message]);
}

function resolveApiKey(provider) {
  if (provider === "google") {
    return process.env.GOOGLE_API_KEY?.trim();
  }
  return process.env.OPENAI_API_KEY?.trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = resolveProvider(args.provider);
  const model = resolveModel(provider, args.model);
  const modelTagValue = modelTag(provider, model);
  const apiKey = resolveApiKey(provider);

  if (!apiKey && !args.dryRun) {
    throw new Error(`${provider.toUpperCase()} API key is required unless --dry-run is used`);
  }

  const pool = getPool();
  const stateKey = `scc_chunk_embeddings:${modelTagValue}`;
  const timeoutMs = parseIntSafe(process.env.LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const useEmbeddingVecColumn = await hasEmbeddingVecColumn(pool);
  console.log(`[info] embedding_vec_column=${useEmbeddingVecColumn}`);
  console.log(`[info] priority_mode=${args.priorityMode}`);

  let totalSelected = 0;
  let totalEmbedded = 0;
  let totalSkipped = 0;
  let totalInserted = 0;
  let totalUpdated = 0;

  try {
    for (let batchIndex = 1; batchIndex <= args.maxBatches; batchIndex += 1) {
      const rows = await fetchCandidateRows(
        pool,
        modelTagValue,
        args.batchSize,
        args.priorityMode
      );

      if (rows.length === 0) {
        break;
      }

      totalSelected += rows.length;

      if (args.dryRun) {
        totalSkipped += rows.length;
        console.log(`[dry-run] batch=${batchIndex} rows=${rows.length}`);
        continue;
      }

      const texts = rows.map((row) => row.chunk_text);
      const embeddings = await createEmbeddings(texts, provider, model, apiKey, timeoutMs);

      let batchInserted = 0;
      let batchUpdated = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const inserted = await upsertEmbedding(
          pool,
          rows[index],
          modelTagValue,
          embeddings[index],
          useEmbeddingVecColumn
        );
        if (inserted) {
          batchInserted += 1;
        } else {
          batchUpdated += 1;
        }
        totalEmbedded += 1;
      }
      totalInserted += batchInserted;
      totalUpdated += batchUpdated;

      console.log(
        `[ok] batch=${batchIndex} selected=${rows.length} embedded=${rows.length} inserted=${batchInserted} updated=${batchUpdated}`
      );
      await upsertState(
        pool,
        stateKey,
        "running",
        `progress batch=${batchIndex}, embedded=${totalEmbedded}, inserted=${totalInserted}, updated=${totalUpdated}, model=${modelTagValue}`
      );
    }

    const message =
      `provider=${provider}, model=${model}, selected=${totalSelected}, embedded=${totalEmbedded}, ` +
      `inserted=${totalInserted}, updated=${totalUpdated}, skipped=${totalSkipped}`;
    await upsertState(pool, stateKey, "ok", message);

    console.log(`[done] ${message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertState(pool, stateKey, "error", message);
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] sync failed");
  console.error(error);
  process.exitCode = 1;
});
