#!/usr/bin/env node
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import pg from "pg";

const { Pool } = pg;

const DEFAULT_PROVIDER = "google";
const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";
const DEFAULT_GOOGLE_MODEL = "gemini-embedding-2-preview";
const DEFAULT_GOOGLE_OUTPUT_DIM = 768;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 4;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_GOOGLE_MIN_INTERVAL_MS = 1500;
const DEFAULT_GOOGLE_MAX_RETRIES = 8;
const DEFAULT_CHUNK_CHARS = 1600;
const MIN_CHUNK_CHARS = 80;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const repoRoot = path.dirname(projectDir);
const DEFAULT_MANUAL_SOURCE_DIR = path.join(repoRoot, "stor", "stor", "manual", "user");

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
  return normalized === "openai" ? "openai" : "google";
}

function resolveModel(provider, raw) {
  if (raw && raw.trim().length > 0) {
    return raw.trim();
  }
  const common = process.env.EMBEDDING_MODEL?.trim();
  if (common) {
    return common;
  }
  if (provider === "openai") {
    return process.env.OPENAI_EMBEDDING_MODEL?.trim() ?? DEFAULT_OPENAI_MODEL;
  }
  return process.env.GOOGLE_EMBEDDING_MODEL?.trim() ?? DEFAULT_GOOGLE_MODEL;
}

function modelTag(provider, model) {
  return `${provider}:${model}`;
}

function parseArgs(argv) {
  const args = {
    provider: resolveProvider(process.env.EMBEDDING_PROVIDER),
    modelRaw: undefined,
    sourceDir: process.env.MANUAL_SOURCE_DIR?.trim() || DEFAULT_MANUAL_SOURCE_DIR,
    batchSize: parseIntSafe(process.env.MANUAL_EMBEDDING_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    maxBatches: parseIntSafe(process.env.MANUAL_EMBEDDING_MAX_BATCHES, DEFAULT_MAX_BATCHES),
    dryRun: false
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
    if (current === "--source-dir" && argv[i + 1]) {
      args.sourceDir = argv[i + 1];
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
    }
  }

  return {
    ...args,
    sourceDir: path.resolve(args.sourceDir),
    model: resolveModel(args.provider, args.modelRaw)
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

function stableUuid(input) {
  const hex = crypto.createHash("sha1").update(input, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
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

async function listDocxFiles(rootDir) {
  const output = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".docx") && !entry.name.startsWith("~$")) {
        output.push(fullPath);
      }
    }
  }
  await walk(rootDir);
  return output.sort((left, right) => left.localeCompare(right));
}

function normalizeText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function inferVersion(fileName) {
  const match = fileName.match(/[_\s-]v([0-9]+(?:\.[0-9]+)*)/i);
  return match?.[1] ?? null;
}

function inferProduct(sourceDir, filePath) {
  const rel = path.relative(sourceDir, filePath);
  const first = rel.split(path.sep)[0];
  return first && first !== path.basename(filePath) ? first : "user-manual";
}

function buildTitle(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function splitLongParagraph(paragraph, maxChars) {
  const chunks = [];
  let rest = paragraph.trim();
  while (rest.length > maxChars) {
    const boundary = Math.max(rest.lastIndexOf(".", maxChars), rest.lastIndexOf(" ", maxChars));
    const end = boundary > MIN_CHUNK_CHARS ? boundary + 1 : maxChars;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest.length > 0) {
    chunks.push(rest);
  }
  return chunks;
}

function chunkManualText(title, text) {
  const maxChars = parseIntSafe(process.env.MANUAL_CHUNK_CHARS, DEFAULT_CHUNK_CHARS);
  const paragraphs = normalizeText(text)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  const chunks = [];
  let current = "";
  let sectionTitle = title;

  function flush() {
    const normalized = current.trim();
    if (normalized.length >= MIN_CHUNK_CHARS) {
      chunks.push({ sectionTitle, text: `${title}\n${normalized}` });
    }
    current = "";
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length <= 80 && /[0-9]+\.|[가-힣A-Za-z]/.test(paragraph)) {
      sectionTitle = paragraph;
    }

    const parts = paragraph.length > maxChars ? splitLongParagraph(paragraph, maxChars) : [paragraph];
    for (const part of parts) {
      if ((current + "\n" + part).trim().length > maxChars) {
        flush();
      }
      current = current ? `${current}\n${part}` : part;
    }
  }

  flush();
  if (chunks.length === 0 && text.trim().length > 0) {
    chunks.push({ sectionTitle: title, text: `${title}\n${text.trim().slice(0, maxChars)}` });
  }
  return chunks;
}

async function extractDocxText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return normalizeText(result.value ?? "");
}

async function upsertDocumentAndChunks(pool, sourceDir, filePath) {
  const stat = await fs.stat(filePath);
  const rawText = await extractDocxText(filePath);
  const title = buildTitle(filePath);
  const product = inferProduct(sourceDir, filePath);
  const sourceRelPath = path.relative(sourceDir, filePath).replace(/\\/g, "/");
  const documentId = stableUuid(`manual:user:${sourceRelPath}`);
  const textHash = toMd5(rawText);
  const chunks = chunkManualText(title, rawText).map((chunk, index) => ({
    chunkId: stableUuid(`manual:user:${sourceRelPath}:${index + 1}:${toMd5(chunk.text)}`),
    chunkSeq: index + 1,
    sectionTitle: chunk.sectionTitle,
    chunkText: chunk.text,
    textHash: toMd5(chunk.text),
    tokenEstimate: Math.ceil(chunk.text.length / 3)
  }));

  await pool.query(
    `
    insert into ai_core.manual_documents (
      document_id, audience, product, title, version, file_ext, source_path, source_rel_path,
      file_size, file_mtime, text_hash, extracted_at, updated_at
    ) values (
      $1::uuid, 'user', $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, now(), now()
    )
    on conflict (document_id) do update set
      audience = excluded.audience,
      product = excluded.product,
      title = excluded.title,
      version = excluded.version,
      file_ext = excluded.file_ext,
      source_path = excluded.source_path,
      source_rel_path = excluded.source_rel_path,
      file_size = excluded.file_size,
      file_mtime = excluded.file_mtime,
      text_hash = excluded.text_hash,
      extracted_at = now(),
      updated_at = now()
    `,
    [
      documentId,
      product,
      title,
      inferVersion(path.basename(filePath)),
      path.extname(filePath).toLowerCase(),
      filePath,
      sourceRelPath,
      stat.size,
      stat.mtime.toISOString(),
      textHash
    ]
  );

  for (const chunk of chunks) {
    await pool.query(
      `
      insert into ai_core.manual_chunks (
        chunk_id, document_id, audience, product, chunk_seq, chunk_type, section_title,
        chunk_text, text_hash, token_estimate, updated_at
      ) values (
        $1::uuid, $2::uuid, 'user', $3, $4, 'manual', $5, $6, $7, $8, now()
      )
      on conflict (chunk_id) do update set
        document_id = excluded.document_id,
        audience = excluded.audience,
        product = excluded.product,
        chunk_seq = excluded.chunk_seq,
        section_title = excluded.section_title,
        chunk_text = excluded.chunk_text,
        text_hash = excluded.text_hash,
        token_estimate = excluded.token_estimate,
        updated_at = now()
      `,
      [chunk.chunkId, documentId, product, chunk.chunkSeq, chunk.sectionTitle, chunk.chunkText, chunk.textHash, chunk.tokenEstimate]
    );
  }

  await pool.query(
    `delete from ai_core.manual_chunks where document_id = $1::uuid and not (chunk_id = any($2::uuid[]))`,
    [documentId, chunks.map((chunk) => chunk.chunkId)]
  );

  return { documentId, title, product, chunkCount: chunks.length };
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
    return list.slice().sort((a, b) => a.index - b.index).map((item) => item.embedding);
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
    const outputDim = parseIntSafe(process.env.GOOGLE_EMBEDDING_OUTPUT_DIM, DEFAULT_GOOGLE_OUTPUT_DIM);
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    if (!response.ok) {
      const bodyText = await response.text();
      const error = new Error(`google embedding failed: ${response.status} ${bodyText}`);
      error.status = response.status;
      error.retryAfterMs = parseRetryAfterMs(response.headers, bodyText);
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
  const minIntervalMs = parseIntSafe(process.env.GOOGLE_EMBEDDING_MIN_INTERVAL_MS, DEFAULT_GOOGLE_MIN_INTERVAL_MS);
  const maxRetries = parseIntSafe(process.env.GOOGLE_EMBEDDING_MAX_RETRIES, DEFAULT_GOOGLE_MAX_RETRIES);
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
      const retryAfterMs = Number.isFinite(retryAfterMsRaw) && retryAfterMsRaw > 0
        ? retryAfterMsRaw
        : Math.min(60000, 1500 * (attempt + 1));
      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt >= maxRetries) {
        throw error;
      }
      console.warn(`[retry] google embedding status=${status}, attempt=${attempt + 1}/${maxRetries}, waitMs=${retryAfterMs}`);
      await sleep(retryAfterMs);
      attempt += 1;
    }
  }
  throw new Error("google embedding retry exhausted");
}

async function createEmbeddings(inputs, provider, model, apiKey, timeoutMs) {
  if (provider === "openai") {
    return createOpenAiEmbeddings(inputs, model, apiKey, timeoutMs);
  }
  const output = [];
  for (const text of inputs) {
    output.push(await createGoogleEmbeddingWithRetry(text, model, apiKey, timeoutMs));
  }
  return output;
}

function resolveApiKey(provider) {
  return provider === "openai" ? process.env.OPENAI_API_KEY?.trim() : process.env.GOOGLE_API_KEY?.trim();
}

async function fetchEmbeddingTargets(pool, modelTagValue, batchSize) {
  const result = await pool.query(
    `
    select
      c.chunk_id::text as chunk_id,
      c.document_id::text as document_id,
      c.audience,
      c.product,
      c.chunk_text,
      c.text_hash
    from ai_core.manual_chunks c
    left join ai_core.manual_chunk_embeddings e
      on e.chunk_id = c.chunk_id
      and e.embedding_model = $1
    where c.audience = 'user'
      and char_length(coalesce(c.chunk_text, '')) > 0
      and (e.chunk_id is null or e.text_hash is distinct from c.text_hash)
    order by c.product, c.document_id, c.chunk_seq
    limit $2
    `,
    [modelTagValue, batchSize]
  );
  return result.rows;
}

async function upsertEmbedding(pool, row, modelTagValue, embedding) {
  const inserted = await pool.query(
    `
    insert into ai_core.manual_chunk_embeddings (
      chunk_id, document_id, audience, product, embedding_model, embedding_dim,
      embedding_values, embedding_vec, embedding_norm, text_hash, embedded_at, updated_at
    ) values (
      $1::uuid, $2::uuid, $3, $4, $5, $6, $7::float8[],
      ('[' || array_to_string($7::float8[], ',') || ']')::vector,
      $8::float8, $9, now(), now()
    )
    on conflict (chunk_id, embedding_model) do update set
      document_id = excluded.document_id,
      audience = excluded.audience,
      product = excluded.product,
      embedding_dim = excluded.embedding_dim,
      embedding_values = excluded.embedding_values,
      embedding_vec = excluded.embedding_vec,
      embedding_norm = excluded.embedding_norm,
      text_hash = excluded.text_hash,
      embedded_at = now(),
      updated_at = now()
    returning (xmax = 0) as inserted
    `,
    [
      row.chunk_id,
      row.document_id,
      row.audience,
      row.product,
      modelTagValue,
      embedding.length,
      embedding,
      vectorNorm(embedding),
      row.text_hash
    ]
  );
  return inserted.rows[0]?.inserted === true;
}

async function upsertState(pool, stateKey, status, message) {
  await pool.query(
    `
    insert into ai_core.embedding_ingest_state (
      state_key, last_source_ingested_at, last_run_at, last_status, last_message, updated_at
    ) values ($1, null, now(), $2, $3, now())
    on conflict (state_key) do update set
      last_run_at = now(),
      last_status = excluded.last_status,
      last_message = excluded.last_message,
      updated_at = now()
    `,
    [stateKey, status, message]
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = resolveProvider(args.provider);
  const model = resolveModel(provider, args.model);
  const modelTagValue = modelTag(provider, model);
  const apiKey = resolveApiKey(provider);
  const timeoutMs = parseIntSafe(process.env.LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  if (!apiKey && !args.dryRun) {
    throw new Error(`${provider.toUpperCase()} API key is required unless --dry-run is used`);
  }

  const stateKey = `manual_chunk_embeddings:${modelTagValue}:user`;
  let totalDocuments = 0;
  let totalChunks = 0;
  let totalSelected = 0;
  let totalEmbedded = 0;
  let totalInserted = 0;
  let totalUpdated = 0;

  const files = await listDocxFiles(args.sourceDir);
  console.log(`[info] source_dir=${args.sourceDir}`);
  console.log(`[info] user_docx_files=${files.length}`);
  console.log(`[info] model=${modelTagValue}`);

  if (args.dryRun) {
    for (const filePath of files) {
      const rawText = await extractDocxText(filePath);
      const title = buildTitle(filePath);
      const chunkCount = chunkManualText(title, rawText).length;
      totalDocuments += 1;
      totalChunks += chunkCount;
      console.log(`[dry-run doc] ${inferProduct(args.sourceDir, filePath)}/${title} chunks=${chunkCount}`);
    }
    console.log(`[dry-run] documents=${totalDocuments}, chunks=${totalChunks}`);
    return;
  }

  const pool = getPool();
  try {
    for (const filePath of files) {
      const result = await upsertDocumentAndChunks(pool, args.sourceDir, filePath);
      totalDocuments += 1;
      totalChunks += result.chunkCount;
      console.log(`[doc] ${result.product}/${result.title} chunks=${result.chunkCount}`);
    }

    for (let batchIndex = 1; batchIndex <= args.maxBatches; batchIndex += 1) {
      const rows = await fetchEmbeddingTargets(pool, modelTagValue, args.batchSize);
      if (rows.length === 0) {
        console.log(`[batch ${batchIndex}] no pending manual chunks`);
        break;
      }

      totalSelected += rows.length;
      console.log(`[batch ${batchIndex}] selected=${rows.length}`);
      const embeddings = await createEmbeddings(rows.map((row) => row.chunk_text), provider, model, apiKey, timeoutMs);

      for (let index = 0; index < rows.length; index += 1) {
        const isInserted = await upsertEmbedding(pool, rows[index], modelTagValue, embeddings[index]);
        totalEmbedded += 1;
        if (isInserted) {
          totalInserted += 1;
        } else {
          totalUpdated += 1;
        }
      }
    }

    const message = `provider=${provider}, model=${model}, documents=${totalDocuments}, chunks=${totalChunks}, selected=${totalSelected}, embedded=${totalEmbedded}, inserted=${totalInserted}, updated=${totalUpdated}`;
    await upsertState(pool, stateKey, "ok", message);
    console.log(`[ok] ${message}`);
  } catch (error) {
    await upsertState(pool, stateKey, "error", error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] manual embedding sync failed");
  console.error(error);
  process.exitCode = 1;
});
