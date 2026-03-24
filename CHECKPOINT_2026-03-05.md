# Checkpoint - 2026-03-05

## Current Goal

Build an independent AI Core service (`workspace-fastify`) and validate via Postman/curl first, then integrate with external web service.

## Decisions Locked

- Service runs independently first (web prompt integration later).
- Retrieval scope will be request-driven: `all` | `manual` | `scc`.
- Health check is operational endpoint, not per-request pre-step.
- Legacy structure does not have to be copied 1:1.

## What Is Done

### Workspace bootstrap

- Initialized `workspace-fastify` with standalone git repo.
- Added base policy/docs files:
  - `workspace-fastify/.gitignore`
  - `workspace-fastify/BOUNDARIES.md`
  - `workspace-fastify/MIGRATION_LOG.md`
  - `workspace-fastify/README.md`
- Added scaffold folders:
  - `src/app`, `src/modules`, `src/platform`, `src/shared`
  - `tests/contract`, `tests/integration`, `docs`, `scripts`

### Runtime skeleton

- Added minimal Fastify runtime:
  - `workspace-fastify/src/app/server.ts`
  - `workspace-fastify/src/app/index.ts`
  - `workspace-fastify/package.json`
  - `workspace-fastify/tsconfig.json`
  - `workspace-fastify/.env.example`

### Verification executed

- `npm run typecheck`: pass
- `npm run build`: pass
- Runtime check:
  - `GET /health` -> `200` with `{"status":"ok","service":"workspace-fastify"}`
  - `GET /v1/chatgptsetting` -> `404` (expected, not implemented yet)

## Guideline Updates Applied

- Updated: `AI_Core_Architect_Guideline_UPDATED.md`
  - Independent validation-first policy added.
  - API path examples switched to no forced `/v1` prefix.
  - Added `retrievalScope` (`all|manual|scc`) in chat request example.
  - Added Postman/curl independent test checklist.
  - Moved web prompt integration to later phase.
- Added alias note file:
  - `AI_Core_Architect_Guideline_UPDATE.md`

## exampleData Findings (for initial indexing plan)

- Found files under `exampleData/`:
  - `SCC 추출 쿼리(1).txt`
  - `SCC 추출 데이터(1).xlsx`
- Observed source columns (sample):
  - `scc_id`, `customer`, `req_type`, `req_type2`, `processor`, `title`, `context`
- Query file also indicates `reply`, `reply_state`, `require_detail_id` availability.

## Target Workflow (MariaDB -> pgvector)

1. External web service calls AI Core (`/chat`).
2. AI Core retrieves from pgvector for `scc/all` scope.
3. AI Core may read MariaDB details as needed (source-of-truth lookup).
4. Separate ingest pipeline syncs MariaDB -> pgvector:
   - initial backfill on first run
   - incremental sync by watermark (`updated_at`)
   - idempotent upsert by stable composite key

## Immediate Next Steps

1. Implement `/chat` with request schema including `retrievalScope`.
2. Add readiness-grade `/health` output (`db/llm/vector` status fields).
3. Define ingestion tables/state (`ingest_jobs`, `ingest_watermark`, vector store table).
4. Implement initial MariaDB -> pgvector backfill worker.
5. Add contract tests for scope behaviors (`all/manual/scc`).
