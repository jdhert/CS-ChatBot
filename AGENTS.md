# AGENTS.md

## Purpose
This file is the project-level handoff and working guide for coding agents.
Use it to understand the current architecture, execution model, constraints, and preferred working rules before making changes.

## Project Layout
- `frontend/`
  - Next.js frontend test client for the AI chatbot UI.
  - Runs on port `3001` in the current local setup.
  - Uses `app/api/chat/route.ts` as a proxy to the AI Core.
- `workspace-fastify/`
  - Fastify-based AI Core backend.
  - Runs on port `3101`.
  - Main chatbot API lives here.
- `src/`, `views/`, legacy files at repo root
  - Older/legacy project assets.
  - Do not assume these are part of the current AI Core + frontend integration unless explicitly required.

## Current Runtime Topology
- Frontend:
  - URL: `http://127.0.0.1:3001`
  - Dev command:
    - `cd frontend`
    - `npm run dev -- --port 3001`
- AI Core backend:
  - URL: `http://127.0.0.1:3101`
  - Health check:
    - `GET /health`
  - Test page:
    - `GET /test/chat`
  - Chat API:
    - `POST /chat`

## Important Port Note
- Port `3000` is currently occupied in this environment by another local process.
- Use `3001` for the frontend unless that conflict is explicitly resolved.

## Environment and Secrets
- `workspace-fastify` uses `.env` via `dotenv/config`.
- Important backend env vars include:
  - `GOOGLE_API_KEY`
  - `GOOGLE_MODEL`
  - `GOOGLE_EMBEDDING_MODEL`
  - `LLM_TIMEOUT_MS`
  - `LLM_CANDIDATE_TOP_N`
  - `LLM_MAX_OUTPUT_TOKENS`
  - `LLM_SKIP_ON_HIGH_CONFIDENCE`
  - `LLM_SKIP_MIN_CONFIDENCE`
- Frontend proxy defaults to:
  - `AI_CORE_BASE_URL=http://127.0.0.1:3101`
  - If unset, the frontend route falls back to that local URL.

## Backend Contract
- The stable UI-facing response contract is the `display` object from `/chat`.
- Frontend code should prefer:
  - `display.title`
  - `display.answerText`
  - `display.linkUrl`
  - `display.linkLabel`
  - `display.status`
  - optionally:
    - `display.answerSource`
    - `display.retrievalMode`
    - `display.confidence`
- Do not rely on raw diagnostic fields for normal UI rendering unless explicitly building a debug tool.

## Current AI Core Behavior
- Retrieval mode:
  - Hybrid retrieval is enabled and working when backend is running correctly.
  - Uses rule-based scoring + pgvector similarity.
- Current answer flow:
  - Retrieval first
  - High-confidence symptom cases may skip LLM
  - Deterministic fallback is used when appropriate
- Current speed tuning:
  - Candidate count for LLM is reduced
  - Prompt snippets are shortened
  - `LLM_MAX_OUTPUT_TOKENS` is capped to reduce latency

## Frontend Status
- Existing imported UI was adapted to call the real AI Core.
- `frontend/app/api/chat/route.ts` proxies requests to `workspace-fastify /chat`.
- Chat messages render backend `display` content.
- Question history is currently implemented as browser-local history via `localStorage`.
- The history screen supports:
  - search
  - status filter
  - replay question
  - open similar issue link

## FAQ Status
- FAQ is not fully implemented yet.
- Recommended future direction:
  1. Add a curated FAQ dataset for high-frequency exact questions.
  2. Match FAQ first.
  3. Fall back to `/chat` retrieval if no FAQ match is found.

## Git / Ownership Notes
- `workspace-fastify/` is the actively managed Git repository for the AI Core work.
- The repo root `coviAI/` itself is not the Git root.
- `frontend/` currently exists under the same workspace and is used for local integration work, but repository ownership may need to be clarified before formal commits.
- Be careful not to assume all root-level folders are part of the current delivery scope.

## Working Rules
- Prefer changes that preserve the stable `display` contract.
- For UI work, keep the imported frontend layout unless there is a clear reason to change it.
- For backend work, maintain:
  - `/chat`
  - `/retrieval/search`
  - `/health`
  - `/test/chat`
- If changing behavior, update supporting documentation when relevant:
  - `workspace-fastify/README.md`
  - `workspace-fastify/AGENT_HANDOFF.md`
  - `workspace-fastify/docs/eval/*`

## Validation Commands
- Backend:
  - `cd workspace-fastify`
  - `npm run typecheck`
  - `npm run build`
- Frontend:
  - `cd frontend`
  - `npm run build`

## Current Known Issues
- Frontend port `3000` conflict exists locally.
- Backend and frontend are separate processes and may need manual restart.
- If the frontend proxy returns `AI_CORE_PROXY_FAILED`, first check whether backend `3101` is actually running.
- Some older imported frontend files had broken text encoding and were manually normalized; if a component shows garbled Korean again, inspect the file contents before editing incrementally.

## Recommended Next Steps
1. Implement curated FAQ mode.
2. Add backend-side persistent chat request logging if operational analytics are needed.
3. Clarify whether `frontend/` should become a formal Git-tracked delivery target.
4. Resolve local port `3000` conflict if strict port alignment is required.
