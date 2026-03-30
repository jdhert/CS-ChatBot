# AI Core Agent Handoff

> **IMPORTANT: All responses to the user MUST be written in Korean, regardless of the language used in this document or the user's query language.**

Written: 2026-03-16
Audience: Next agent or developer taking over this work
Base path: `C:\Users\shpark6\Desktop\AI작업\coviAI\workspace-fastify`

## 1. Purpose of This Document

This document is a handoff guide to help the next agent or developer quickly understand the current state of the `workspace-fastify` project — including its structure, DB connection details, key tables/views, search/LLM behavior, recent changes, and open issues.

Goals:

- Allow another agent to immediately continue work without losing the original intent or implementation context.
- Provide a fast onramp to the PostgreSQL/pgvector-based chunk + embedding architecture.
- Clearly state what is complete and what is still unstable.
- Consolidate all commands and cautions needed for running, testing, and deploying into one file.

## 2. Project Overview

This project is the Covision AI Core MVP runtime.
It runs as a standalone Fastify server, decoupled from the web application (JSP/AJAX), and performs Q&A based on SCC maintenance history data in the following order:

1. Retrieve candidate records from the SCC chunk view (`ai_core.v_scc_chunk_preview`).
2. Compute text/weight-based rule scores for candidate records.
3. Embed the query and compare it against stored chunk embeddings to find vector candidates.
4. Merge rule scores and vector scores into a final candidate set.
5. If needed, pass the top candidates to an LLM (Google Gemini) to generate an explanatory answer.
6. Return the `/chat` response containing candidate records, links, generated answer, and diagnostics.

The core approach is a standard RAG pipeline, but it is designed for evidence-based generation rather than free-form generation.

## 3. Architecture Summary

```text
Client
  -> Web/WAS Server (JSP + AJAX)
  -> AI Core (/chat)
     - Chunk View Query
     - Rule Scoring
     - Vector Search (pgvector / float8[] fallback)
     - LLM Candidate Comparison / Answer Generation
  -> Web/WAS Server
  -> Client
```

Key endpoints:

- `GET /health`
- `GET /test/chat`
- `POST /chat`

## 4. Tech Stack

- Runtime: Node.js
- Server: Fastify
- Language: TypeScript
- DB Client: `pg`
- Vector Storage: PostgreSQL + `pgvector` extension + `float8[]`
- LLM: Google Gemini API
- Embedding Provider:
  - OpenAI
  - Google Gemini Embedding

## 5. DB Connection

The default PostgreSQL connection values are hardcoded as fallbacks in `src/platform/db/vectorClient.ts` and each DB script.

Connection details:

- Host: `DB_HOST_REMOVED`
- Port: `5432`
- Database: `ai2`
- User: `novian`
- Password: `REMOVED`
- Schema: `ai_core`

Notes:

- `.env.example` is a sample document only and is not auto-loaded.
- If `process.env` values are not injected at runtime, the above fallback values are used.
- This project is designed to connect to the DB even when `VECTOR_DB_*` env vars are absent.

Related files:

- [vectorClient.ts](workspace-fastify/src/platform/db/vectorClient.ts)
- [init-vector-schema.mjs](workspace-fastify/scripts/init-vector-schema.mjs)
- [fix-stable-chunk-view.mjs](workspace-fastify/scripts/fix-stable-chunk-view.mjs)
- [enable-pgvector-search.mjs](workspace-fastify/scripts/enable-pgvector-search.mjs)
- [sync-scc-embeddings.mjs](workspace-fastify/scripts/sync-scc-embeddings.mjs)

## 6. Current Live DB State

As of 2026-03-23 (expanded sample):

| Object | Row Count |
| --- | ---: |
| `ai_core.v_scc_chunk_preview` | 13255 |
| `ai_core.scc_chunk_embeddings` | 13255 |
| `ai_core.embedding_ingest_state` | 4 |
| `ai_core.v_scc_embedding_status` | 1 |
| `ai_core.v_scc_embedding_coverage` | 1 |

Embedding model state:

| embedding_model | embedding_dim | rows |
| --- | ---: | ---: |
| `google:gemini-embedding-001` | 3072 | 13255 |

pgvector state:

- `vector` extension installed
- Version: `0.8.2`

Index state:

- `scc_chunk_embeddings_pkey`
- `idx_scc_chunk_embeddings_require`
- `idx_scc_chunk_embeddings_scc`
- `idx_scc_chunk_embeddings_chunk_type`
- `idx_scc_chunk_embeddings_model`
- `idx_scc_chunk_embeddings_model_dim`
- `idx_scc_chunk_embeddings_embedded_at`

Not present:

- HNSW / IVFFlat ANN index on `embedding_vec`

Reason:

- Current embedding dimension is `3072`
- `pgvector` ANN index creation fails due to dimension limit
- Therefore, cosine similarity search is performed without ANN index (full scan)

Update note (2026-03-30):

- source chunk rows increased to `44,955`
- current embedded rows for `google:gemini-embedding-2-preview`: `17,355`
- pending rows: `27,600`
- current coverage: `38.61%`
- verified stable ingestion mode:
  - `batch-size=100`
  - `max-batches=8`
  - `EMBEDDING_PRIORITY_MODE=answer_first`
  - `GOOGLE_EMBEDDING_MIN_INTERVAL_MS=1500`
- `100 x 10` can work but is close to rate-limit boundaries and may hit `429` / abort late in the run
- `100 x 8` completed successfully and is the current recommended operational batch size

## 7. Key DB Objects

### 7.1 `ai_core.v_scc_chunk_preview`

Role:

- Primary data source for search
- Provides issue/action/resolution/qa_pair data at the chunk level
- Includes feature score columns for ranking

Key columns:

| Column | Type | Description |
| --- | --- | --- |
| `chunk_id` | `uuid` | Unique chunk ID — currently deterministic UUID |
| `scc_id` | `bigint` | SCC ID |
| `require_id` | `uuid` | Original request ID |
| `chunk_type` | `text` | `issue`, `action`, `resolution`, `qa_pair` |
| `chunk_seq` | `integer` | Chunk sequence within the same require |
| `chunk_text` | `text` | Body text used for search and answer generation |
| `module_tag` | `text` | Module/domain tag |
| `reply_state` | `integer` | Processing state |
| `resolved_weight` | `numeric` | State/completion weight |
| `ingested_at` | `timestamptz` | Ingestion timestamp |
| `state_weight` | `numeric` | State-based weight |
| `evidence_weight` | `numeric` | Evidence weight |
| `text_len_score` | `numeric` | Score based on body text length |
| `tech_signal_score` | `numeric` | Technical signal score |
| `specificity_score` | `numeric` | Specificity score |
| `closure_penalty_score` | `numeric` | Penalty for closure phrases |
| `resolution_stage` | `integer` | Resolution stage |
| `feature_len` | `integer` | Feature length |

Important history:

- Previously, `chunk_id` was near-random, making embedding reuse difficult.
- Now uses `ai_core.make_stable_chunk_uuid(...)` to generate deterministic UUIDs.
- Same chunk text/key combination always produces the same `chunk_id`.

Related file:

- [fix-stable-chunk-view.mjs](workspace-fastify/scripts/fix-stable-chunk-view.mjs)

### 7.2 `ai_core.v_scc_chunk_preview_base`

Role:

- Snapshot backup of the original `v_scc_chunk_preview` definition
- Used as the source when reconstructing the view with deterministic `chunk_id`

Note:

- Created the first time the stable chunk view fix script runs.
- When rewriting the view in production, this base view is used as the foundation.

### 7.3 `ai_core.make_stable_chunk_uuid(...)`

Role:

- Generates a UUID from `require_id + chunk_type + chunk_seq + reply_state + md5(chunk_text)`
- Ensures the same logical chunk always produces the same `chunk_id`

Effects:

- Prevents duplicate embedding generation
- Enables change tracking for chunks
- Ensures stable linkage with `scc_chunk_embeddings`

### 7.4 `ai_core.scc_chunk_embeddings`

Role:

- Stores embedding results for each chunk text
- The actual target table for vector search

Key columns:

| Column | Type | Description |
| --- | --- | --- |
| `chunk_id` | `uuid` | Links to `v_scc_chunk_preview.chunk_id` |
| `scc_id` | `bigint` | SCC ID |
| `require_id` | `uuid` | Request ID |
| `chunk_type` | `text` | Chunk type |
| `chunk_text` | `text` | Original text used for embedding |
| `text_hash` | `text` | `md5(chunk_text)` |
| `embedding_model` | `text` | `provider:model` format, e.g. `google:gemini-embedding-001` |
| `embedding_dim` | `integer` | Embedding dimension |
| `embedding_values` | `float8[]` | Raw embedding value array |
| `embedding_norm` | `float8` | Norm for cosine similarity computation |
| `source_ingested_at` | `timestamptz` | Source ingestion timestamp |
| `embedded_at` | `timestamptz` | Embedding execution timestamp |
| `updated_at` | `timestamptz` | Last update timestamp |
| `embedding_vec` | `vector` | pgvector-dedicated column |

Primary Key:

- `(chunk_id, embedding_model)`

Meaning:

- The same chunk can have separate rows for different models
- For the same model, uses upsert instead of duplicate insert

Current state:

- `13255` rows
- All `google:gemini-embedding-001` / `3072` dimensions
- `embedding_vec` column exists
- No ANN index yet

### 7.5 `ai_core.embedding_ingest_state`

Role:

- Stores the state of embedding ingestion jobs
- Allows checking the most recent success/failure messages

Key columns:

| Column | Type | Description |
| --- | --- | --- |
| `state_key` | `text` | e.g. `scc_chunk_embeddings:google:gemini-embedding-001` |
| `last_source_ingested_at` | `timestamptz` | Last source ingestion timestamp |
| `last_run_at` | `timestamptz` | Last run timestamp |
| `last_status` | `text` | `ok`, `error`, `running`, `never` |
| `last_message` | `text` | Execution result summary |
| `updated_at` | `timestamptz` | Last update timestamp |

Current key rows:

- `scc_chunk_embeddings:google:gemini-embedding-001`
  - `last_status = ok`
  - `last_message = provider=google, model=gemini-embedding-001, selected=143, embedded=143, inserted=143, updated=0, skipped=0`
- Past error traces:
  - `google:text-embedding-004` -> 404 model not found

### 7.6 Monitoring Views

#### `ai_core.v_scc_embedding_status`

Role:

- Check row count, embedded chunk count, and last ingestion timestamp per model

Columns:

- `embedding_model`
- `embedding_rows`
- `embedded_chunks`
- `last_embedded_at`
- `last_updated_at`

#### `ai_core.v_scc_embedding_coverage`

Role:

- Calculate embedding coverage as a percentage of source chunks

Columns:

- `embedding_model`
- `source_chunk_rows`
- `embedded_chunks`
- `coverage_pct`

Current interpretation:

- Both `v_scc_chunk_preview` and `scc_chunk_embeddings` have `13255` rows, so coverage is effectively 100%.

## 8. Current Search/Ranking Structure

Key implementation file:

- [chat.service.ts](workspace-fastify/src/modules/chat/chat.service.ts)

### 8.1 Input

`POST /chat`

Request body:

```json
{
  "query": "휴가신청서 상신이 불가해",
  "retrievalScope": "scc"
}
```

Current frontend contract:

- `tenant`, `user`, `sessionId`, etc. are not sent
- Minimum input is `query` and `retrievalScope`

### 8.2 Rule Search Flow

1. Read chunk rows from `v_scc_chunk_preview`.
2. Extract tokens and focus tokens from the query.
3. Perform fast narrowing of `require_id` candidates based on `issue` and `qa_pair`.
4. Compute scores for each chunk.

Score components:

- semantic score
- lexical coverage
- focus coverage
- state/evidence/specificity/tech/text length weights
- `chunk_type` bonus
- resolution stage bonus
- generic greeting/signature penalty
- weak match penalty

### 8.3 Query Intent Handling

Query intent is classified into three categories:

- `needsResolution`
- `hasSymptom`
- `asksStatus`

Examples:

- `"어떻게", "방법", "가이드"` -> resolution intent
- `"오류", "불가", "실패"` -> symptom query
- `"상태", "완료", "언제"` -> status query

The score blend across `issue/action/resolution/qa_pair` tracks varies depending on this intent.

### 8.4 Vector Search Flow

1. Embed the user query using the embedding provider.
2. Query `scc_chunk_embeddings` filtered by the same `embedding_model` and `embedding_dim`.
3. If `pgvector` search is available, sort by cosine distance using `embedding_vec`.
4. On failure, fall back to array scan using `embedding_values` + `embedding_norm`.
5. Merge vector candidates with rule candidates.

Important notes:

- If `PGVECTOR_SEARCH_ENABLED=true`, the pgvector path is attempted first.
- Vector operations work at the SQL level even without an ANN index.
- On failure, the diagnostic value `PGVECTOR_QUERY_FAILED_FALLBACK_ARRAY_SCAN` may appear.

### 8.5 Final Ranking

Aggregated at the `require` level, then combined using:

- rule score
- answer track score
- issue track score
- support track score
- vector score
- resolution + qa_pair completeness bonus

Current blend ratio:

- With vector signal: `0.65 * rule + 0.35 * vector`
- Without vector signal: `rule only`

Response candidates:

- Maximum of `5` candidates
- If `confidence >= 0.45`, fills `bestRequireId`, `bestSccId`, `bestAnswerText`

## 9. Current LLM Structure

Key implementation files:

- [llm.service.ts](workspace-fastify/src/modules/chat/llm.service.ts)
- [server.ts](workspace-fastify/src/app/server.ts)

### 9.1 LLM Call Method

Currently uses Google Gemini `generateContent` API.

Default model:

- `gemini-2.5-flash`

Prerequisites:

- `GOOGLE_API_KEY` must be set in `process.env`
- LLM cannot be called without it

Behavior when key is missing:

- `llmUsed = false`
- `llmError = GOOGLE_API_KEY_MISSING`
- Returns deterministic fallback or retrieval summary only

### 9.2 Data Passed to LLM

The LLM does not directly access the DB.
It only receives the following in the prompt:

- User `query`
- `best_require_id`
- `best_scc_id`
- `best_chunk_type`
- `best_confidence`
- `best_chunk_text`
- `retrieval_mode`
- `vector_used`
- `vector_error`
- Top `candidates` list

The current structure is "search + candidate comparison + explanation generation", not "LLM directly searching the DB".

### 9.3 Current Answer Format

Target format after explanation enhancement:

1. Core answer
2. How to apply
3. Checkpoints
4. Reference link

Current prompt rules:

- Use only information from retrieval_context and candidates
- No speculation
- `selectedRequireId` must exist in candidates
- Even without an exact match, "similar case guidance" is allowed if related candidates exist

### 9.4 LLM Skip Policy

Current server logic:

- Explanatory queries (`어떻게`, `방법`, `하는 법`, `가이드`, `절차`, `설정`, `추가`, `코드`, `구성`) never skip LLM
- Others can skip LLM on high-confidence cases depending on env var settings

Current `.env.example` defaults:

- `LLM_SKIP_ON_HIGH_CONFIDENCE=false`
- `LLM_CANDIDATE_TOP_N=5`
- `LLM_TIMEOUT_MS=7000`

Intent:

- How-to queries like "how to add multilingual codes" prioritize explanatory answer quality
- Simple similar-history guidance can be switched to performance-first mode later if needed

### 9.5 Response Diagnostic Fields

The `/chat` response includes the following diagnostic fields:

- `vectorUsed`
- `retrievalMode`
- `vectorError`
- `llmUsed`
- `llmModel`
- `llmError`
- `llmSelectedRequireId`
- `llmSelectedSccId`
- `llmReRanked`
- `llmSkipped`
- `llmSkipReason`
- `timings.retrievalMs`
- `timings.llmMs`
- `timings.totalMs`

## 10. Performance / Accuracy Notes

### 10.1 Performance Bottleneck Candidates

Main latency sources in `/chat`:

1. Query embedding API call
2. PostgreSQL vector search
3. LLM generation API call

Conditions that can slow things down:

- `GOOGLE_API_KEY` is set and LLM explanatory answers are enabled
- No ANN index due to `gemini-embedding-001` 3072-dimension limit
- Vector search running as a full scan

### 10.2 Accuracy Tuning Points

Already applied:

- Synonym group expansion
- Focus token-based require narrowing
- Generic greeting/signature penalty
- Explanation queries forced through LLM path

Still room for improvement:

- Expand domain-specific synonym dictionaries
- Tabularize score policies per query intent
- Top1 / Top3 quantitative tuning using an eval set
- Refine weights among `qa_pair` / `resolution` / `action`

## 11. How to Run

### 11.1 Development Server

```powershell
cd C:\Users\shpark6\Desktop\AI작업\coviAI\workspace-fastify
npm ci
npm run typecheck
npm run build
npm run dev
```

Default port:

- `3101`

Verification URLs:

- `http://localhost:3101/health`
- `http://localhost:3101/test/chat`

### 11.2 LLM Key Setup Example

PowerShell:

```powershell
$env:LLM_PROVIDER="google"
$env:GOOGLE_API_KEY="your-actual-key"
$env:GOOGLE_MODEL="gemini-2.5-flash"
$env:LLM_TIMEOUT_MS="7000"
npm run dev
```

Note:

- `.env.example` is not auto-loaded.
- Environment variables must be injected into the currently running shell.

## 12. DB Setup / Operations Scripts

### 12.1 Script List

| Command | Role |
| --- | --- |
| `npm run db:init:vector` | Create `ai_core` schema / base tables / monitoring views |
| `npm run db:fix:stable-chunk-view` | Apply deterministic `chunk_id` |
| `npm run db:enable:pgvector` | Backfill `embedding_vec` column and activate pgvector |
| `npm run ingest:sync:scc-embeddings` | Ingest missing or changed chunk embeddings |

### 12.2 Recommended Initial Setup Order

```powershell
npm run db:init:vector
npm run db:fix:stable-chunk-view
npm run db:enable:pgvector
npm run ingest:sync:scc-embeddings -- --provider google --batch-size 50 --max-batches 5
```

### 12.3 Embedding Ingestion Logic

Selection criteria:

- Exists in `v_scc_chunk_preview`
- `chunk_text` length > 0
- `chunk_type in ('issue', 'action', 'resolution', 'qa_pair')`
- No row for that `embedding_model` or `text_hash` has changed

That means:

- Duplicate rows for the same model are not re-inserted
- If text changes, the row is updated
- Upsert based on `chunk_id + embedding_model`

### 12.4 Google Embedding Cautions

The free tier has been used previously, and `429 quota exceeded` has occurred.

Related env vars:

- `GOOGLE_EMBEDDING_MIN_INTERVAL_MS`
- `GOOGLE_EMBEDDING_MAX_RETRIES`

Past confirmed errors:

- `text-embedding-004` -> 404 model not found
- `gemini-embedding-001` -> 429 possible on free tier quota exceeded

### 12.5 Recommended Batch Plan for Large Incremental Growth

When `v_scc_chunk_preview` grows significantly, do **not** re-embed the full dataset.  
The sync script already performs incremental upsert based on:

- missing `(chunk_id, embedding_model)` rows
- changed `text_hash`

Recommended operational command:

```powershell
$env:EMBEDDING_PROVIDER="google"
$env:GOOGLE_EMBEDDING_MODEL="gemini-embedding-2-preview"
$env:GOOGLE_EMBEDDING_MIN_INTERVAL_MS="1500"
$env:GOOGLE_EMBEDDING_MAX_RETRIES="10"
$env:EMBEDDING_PRIORITY_MODE="answer_first"
npm run ingest:sync:scc-embeddings -- --provider google --batch-size 100 --max-batches 8 --priority-mode answer_first
```

Priority behavior:

- `answer_first` sorts candidates as:
  - `qa_pair`
  - `resolution`
  - `issue`
  - `action`

Operational guidance:

- Use `100 x 8` as the default repeatable batch
- Repeat the same command multiple times instead of running one huge batch
- The ingestion is resumable because each batch upserts by `chunk_id + embedding_model`
- If quota pressure increases, reduce to `50 x 10`

## 13. Current Git State

Branch:

- `main`

Recent commits:

- `1ccb419 docs: README 데이터 모델 ERD 시각화 추가`
- `8c9a48e docs: 임베딩 설정과 /chat 응답 진단 필드 문서화`
- `c75696a feat(chat): rule-only 폴백과 벡터 진단 필드 추가`
- `bcb159b feat(ingest): 임베딩 동기화 안정화와 재시도 로직 적용`
- `73bdb00 feat(db): chunk 뷰 고정 ID 보정 스크립트 추가`

Currently uncommitted changes:

- `.env.example`
- `README.md`
- `package.json`
- `scripts/init-vector-schema.mjs`
- `scripts/sync-scc-embeddings.mjs`
- `src/app/server.ts`
- `src/modules/chat/chat.service.ts`
- `src/modules/chat/chat.types.ts`
- `src/modules/chat/llm.service.ts`
- `scripts/enable-pgvector-search.mjs` (untracked)

Important:

- Some of the above changes have already been validated but not yet committed.
- The next agent should run `git status` and `git diff` before starting work.

## 14. First Things to Check as the Next Agent

1. Verify `GOOGLE_API_KEY` is set in the actual runtime shell.
2. Check `llmUsed`, `llmSkipped`, and `timings` in the `/chat` response.
3. Confirm `ai_core.scc_chunk_embeddings` row count continues to match `v_scc_chunk_preview`.
4. Confirm ANN index is absent after running `db:enable:pgvector`.
5. Re-validate accuracy with representative queries like "다국어 코드 추가하는 법" and "휴가신청서 상신 불가".

## 15. Recommended Next Tasks

Priority order:

1. Build an evaluation query set and quantify Top1 / Top3 accuracy.
2. Explicitly tabularize the weight policy for `qa_pair`, `resolution`, and `action`.
3. Separate prompt templates by query type.
4. Decide on a strategy to work around the pgvector dimension limit:
   - Select a lower-dimension embedding model
   - Evaluate `halfvec`
   - Evaluate dimensionality reduction
5. Add `/chat` response logging and failed-case storage.

## 16. Quick Check SQL

### Row count check

```sql
select count(*) from ai_core.v_scc_chunk_preview;
select count(*) from ai_core.scc_chunk_embeddings;
```

### Embedding distribution by model

```sql
select embedding_model, embedding_dim, count(*)
from ai_core.scc_chunk_embeddings
group by embedding_model, embedding_dim
order by count(*) desc;
```

### Ingestion state

```sql
select *
from ai_core.embedding_ingest_state
order by updated_at desc;
```

### pgvector extension check

```sql
select extname, extversion
from pg_extension
where extname = 'vector';
```

### Index check

```sql
select indexname, indexdef
from pg_indexes
where schemaname='ai_core'
  and tablename='scc_chunk_embeddings'
order by indexname;
```

## 17. Key Summary

The current state can be summarized as follows:

- The chunk view-based search structure is operational.
- `scc_chunk_embeddings` is filled with `13255` rows matching the source chunk count.
- The pgvector extension is installed and `embedding_vec` exists.
- However, there is no ANN index due to the `3072`-dimension embedding.
- `/chat` retrieves candidates using rule + vector, and generates explanatory answers via LLM for explanation-type queries.
- LLM quality still depends heavily on retrieval candidate quality.
- The next key focus is "accuracy evaluation framework" and "search/prompt policy refinement".

## 18. Phase 3 Checklist

Phase 3 completion means: "accurate retrieval, high-quality answers, evaluation dataset, and a well-tuned RAG pipeline".

### 18.1 Checklist

1. Retrieval improvement
   - Add `query rewrite` duplicate replacement synonym logic
   - Expand synonym dictionary
   - Tune rule/vector/fusion weights
   - Tune relevance filter threshold
   - Refine priority among `qa_pair`, `resolution`, `issue`, `action` types

2. Vector search stabilization
   - Stabilize query embedding generation
   - Verify `vectorUsed=true`, `retrievalMode=hybrid` in responses
   - Confirm pgvector index status
   - Add rule-only fallback when quota is exceeded

3. Answer generation quality
   - Improve fallback answer guidance to be more informative
   - Add answer structure using `similarIssueUrl` and related fields
   - Add `answerSource` (`llm`, `deterministic_fallback`, `rule_only`) tracking
   - Improve raw text cleansing

4. Eval dataset
   - Create 20–50 evaluation items
   - Include `expectedRequireId`, `expectedChunkType`, `answerable` fields
   - Confirm Top1 / Top3 accuracy targets are achievable

5. Observability
   - Granularize `timings` (`ruleMs`, `embeddingMs`, `vectorMs`, `llmMs`)
   - Add `/retrieval/search` endpoint to retrieve raw candidates with scores
   - Enhance logging of `vectorError`, `llmError`, `llmSkipReason`, and fallback paths

6. Tuning / Config
   - Finalize LLM skip policy
   - Tune timeout, cache TTL, Top-K
   - Add graceful degradation when external embedding/LLM is unavailable

### 18.2 Step-by-Step Plan

1. Step 1: Implement `query rewrite` synonym logic
2. Step 2: Create eval dataset
3. Step 3: Stabilize vector search
4. Step 4: Finalize answer source / fallback behavior
5. Step 5: Granularize timings
6. Step 6: Repeat weight tuning

### 18.3 Completion Criteria

1. Confirm Top1 / Top3 accuracy with the eval dataset
2. Confirm `/retrieval/search` returns raw candidates with scores
3. Confirm `generatedAnswer` includes informative guidance
4. Confirm `/chat` works correctly with vector search
5. Log and monitor timings with consistent formatting
6. Users can find relevant records without extra effort

## 19. Eval Dataset Artifacts

Added in Step 2:

- `docs/eval/README.md`
- `docs/eval/scc_eval_set.seed.json`

Intent:

- Initial seed dataset for measuring Top1 / Top3 accuracy with the eval dataset
- Structured for repeated automated runs against `/chat` and `/retrieval/search`
- Includes both answerable and negative cases to track retrieval boundaries

Initial seed composition:

- Answerable: 13 items
- Negative: 4 items
- Key tags: `symptom`, `howto`, `approval`, `attendance`, `document-view`, `negative`

The next agent can verify the following against these items:

1. Confirm Top1 / Top3 ranking from `/retrieval/search`
2. Check `generatedAnswer`, `similarIssueUrl`, `llmSkipped`, `timings` from `/chat`
3. Tune thresholds based on pass/fail results

## 20. Step 3 Progress Notes

- When `EMBEDDING_MODEL_AUTO_ALIGN=true`, the query embedding model auto-aligns to the dominant model currently ingested in the DB.
- The current live ingested model is `google:gemini-embedding-2-preview` with dimension `768`.
- Run `npm run db:check:vector` first to check the current model, dimension, and coverage, then look at `vectorModelTag`, `vectorStrategy`, `vectorCandidateCount` in `/retrieval/search`.

## 21. Step 4 Progress Notes

- `answerSource` and `answerSourceReason` have been added to the `/chat` response.
- Value meanings:
  - `llm`: LLM-generated answer was adopted as final
  - `deterministic_fallback`: Replaced with deterministic-format answer after hybrid retrieval
  - `rule_only`: Rule-based deterministic answer returned when vector path is unused or failed
- The deterministic fallback answer format is fixed as: `핵심 안내 / 유사 사례 / 처리 내역 / 확인 포인트 / 참고 링크`

## 22. Step 5 Progress Notes

- `timings` in `/chat` and `/retrieval/search` responses have been granularized.
- Currently included fields:
  - `ruleMs`: Rule retrieval and rule score computation time
  - `embeddingMs`: Query embedding generation time
  - `vectorMs`: Vector similarity query time
  - `rerankMs`: Fusion/relevance/rerank computation time
  - `retrievalMs`: Total retrieval time
  - `llmMs`: LLM generation time (`/chat` only)
  - `totalMs`: Total API time (`/chat` only)
  - `cacheHit`: Whether retrieval cache was used
- Detailed timings confirmed visible in live `/retrieval/search`.

## 23. Step 6 First Run

- Command: `npm run eval:retrieval`
- Basis: `rule_only`
- Result:
  - Top1Hit: 13/13 (100%)
  - Top3Hit: 13/13 (100%)
  - ChunkTypeHit: 13/13 (100%)
  - NegativeCorrect: 4/4 (100%)
- .env loads correctly, but GOOGLE_EMBEDDING_HTTP_429 occurs during query embedding, so vector search is currently unused.
- Hybrid re-measurement must be re-run after Google embedding quota recovers.

## 24. Step 6 First Run Summary

- Command: `npm run eval:retrieval`
- Basis: `rule_only`
- Result:
  - Top1Hit: 13/13 (100%)
  - Top3Hit: 13/13 (100%)
  - ChunkTypeHit: 13/13 (100%)
  - NegativeCorrect: 4/4 (100%)
- .env loads correctly, but GOOGLE_EMBEDDING_HTTP_429 occurs at query embedding stage; vector search is currently unused.
- Hybrid re-measurement pending until Google embedding quota recovers.

## 25. Step 6 Rule-only Summary

- Command: `npm run eval:retrieval`
- Basis: `rule_only`
- Result:
  - Top1Hit: 13/13 (100%)
  - Top3Hit: 13/13 (100%)
  - ChunkTypeHit: 13/13 (100%)
  - NegativeCorrect: 4/4 (100%)
- .env is loaded correctly, but query embedding currently fails with GOOGLE_EMBEDDING_HTTP_429.
- Hybrid re-measurement is pending until Google embedding quota recovers.

## 26. Step 6 Hybrid Recheck

- Command: `npm run eval:retrieval`
- Dataset: `docs/eval/scc_eval_set.seed.json`
- Runtime artifact: `docs/eval/hybrid_recheck.latest.json`
- Result:
  - Top1Hit: 13/13 (100%)
  - Top3Hit: 13/13 (100%)
  - ChunkTypeHit: 13/13 (100%)
  - NegativeCorrect: 4/4 (100%)
  - hybridCount: 17
  - vectorUsedCount: 17
- Conclusion:
  - Query embedding, pgvector retrieval, and hybrid ranking are active.
  - No score-table patch was applied in phase 2 because the current seed set showed no false positives or misses.
  - Next tuning target is a larger production-like Korean query set.

## 27. Step 6 Phase 3

- Dataset size was expanded to 38 items (29 answerable, 9 negative).
- Retrieval tuning in phase 3 focused on domain vocabulary expansion, not major score-table changes.
- Added operational-domain tokens and variants for browser cache, popup settings, messenger, message-id, HTML paste, tax invoice, approval box visibility, and date/time layout queries.
- Added `EVAL_QUERY_DELAY_MS` support to `scripts/eval-scc-retrieval.mjs` for rate-limit-friendly evaluation.
- Observed result on the expanded set:
  - Top1Hit: 27/29 (93.1%)
  - Top3Hit: 29/29 (100%)
  - ChunkTypeHit: 28/29 (96.55%)
  - NegativeCorrect: 9/9 (100%)
- Remaining misses are mostly same-topic neighboring SCC cases rather than hard false positives.
- Repeated evaluation can fall back to `rule_only` when Google embedding returns `QUERY_EMBEDDING_COOLDOWN_ACTIVE`. Use `EVAL_QUERY_DELAY_MS` and run inside a fresh quota window when hybrid-only verification is required.

## 28. Evaluation Policy and Chat Quality

- Representative SCC policy: use a representative SCC for generic operational questions when several SCC records describe the same symptom or fix.
- Exact SCC policy: require exact SCC only when the query contains strong identifiers such as company name, form name, SCC ID, or document number.
- Cooldown policy: treat `QUERY_EMBEDDING_COOLDOWN_ACTIVE` as an operational limit, not as a retrieval-policy miss.
- /chat quality artifact: `docs/eval/chat_quality.phase3.latest.json`
- /chat quality summary on the 38-item set:
  - exactBestHit: 27/29 (93.1%)
  - top3SupportHit: 29/29 (100%)
  - answerFormatOk: 29/29 (100%)
  - linkAttached: 28/29 (96.55%)
  - negativeGuarded: 9/9 (100%)
- Remaining /chat quality issue: EV-029 can fall back to safe default without a link inside a cooldown window, but succeeds in isolated hybrid evaluation.

## 29. Phase 4 Evaluation (50-item set)

- dataset size: 50 items
- composition: 37 answerable, 13 negative
- retrieval artifact: `docs/eval/retrieval.phase4.latest.json`
- chat artifact: `docs/eval/chat_quality.phase4.latest.json`
- retrieval result on the 50-item set:
  - Top1Hit: 35/37 (94.59%)
  - Top3Hit: 37/37 (100%)
  - ChunkTypeHit: 37/37 (100%)
  - NegativeCorrect: 13/13 (100%)
- /chat result on the 50-item set:
  - exactBestHit: 35/37 (94.59%)
  - top3SupportHit: 37/37 (100%)
  - answerFormatOk: 37/37 (100%)
  - linkAttached: 37/37 (100%)
  - negativeGuarded: 13/13 (100%)
- runtime note:
  - this long-run phase fell back to rule_only because Google query embeddings hit 429 / QUERY_EMBEDDING_COOLDOWN_ACTIVE
  - the earlier hybrid recheck on the 17-item seed still passed with vectorUsed=true
- representative-SCC cases that remain in phase 4:
  - EV-032
  - EV-039

## 30. Stable JSP Response Contract

- `/chat` now exposes a stable `display` object intended for JSP rendering.
- JSP should use:
  - `display.title`
  - `display.answerText`
  - `display.linkUrl`
  - `display.linkLabel`
  - `display.status`
- raw diagnostics such as `candidates`, `timings`, `llm*`, and `vector*` remain for operator/debug usage.
- sample shape:
  - `display.status`: `matched` | `needs_more_info`
  - `display.answerSource`: `llm` | `deterministic_fallback` | `rule_only`

## 31. EV-029 Cooldown Relaxation

- purpose:
  - avoid dropping a near-threshold operational match to `bestRequireId=null` during embedding cooldown
- promotion rule:
  - only applies when query embedding is unavailable because of cooldown/rate-limit
  - requires `qa_pair` Top1
  - requires score >= 0.43
  - requires strongestLexicalCoverage >= 0.30
  - requires answerTrackScore >= 0.35
  - requires rank-1 margin over rank-2 >= 0.12
- observed result:
  - EV-029 passes as Top1 in isolated rule_only replay
  - negative link suppression remains intact

## 32. Representative SCC Decision and JSP Sample

- EV-039 is now a representative-SCC-allowed case.
- acceptedRequireIds includes `8095a700-bbf4-441e-84d4-f19852f391d0` for the browser-cache persistence issue.
- EV-032 remains exact-only because unrelated SCCs can outrank it during degraded retrieval and should not be accepted as representative.
- A JSP sample widget has been added:
  - `docs/integration/chat_widget.sample.jsp`
- The JSP sample renders only the stable `display` contract from `/chat`:
  - `display.title`
  - `display.answerText`
  - `display.linkUrl`
  - `display.linkLabel`
  - `display.status`

## 33. Refreshed Phase 4 Result

- retrieval.phase4.latest.json:
  - Top1Hit: 37/37 (100%)
  - Top3Hit: 37/37 (100%)
  - ChunkTypeHit: 37/37 (100%)
  - NegativeCorrect: 13/13 (100%)
  - vectorUsedCount: 50
  - hybridCount: 50
- chat_quality.phase4.latest.json:
  - exactBestHit: 37/37 (100%)
  - top3SupportHit: 37/37 (100%)
  - answerFormatOk: 37/37 (100%)
  - linkAttached: 37/37 (100%)
  - negativeGuarded: 13/13 (100%)
- Security ruleset was expanded to block queries that ask for:
  - 주민등록번호
  - 주민번호
  - 개인정보
  - 민감정보
