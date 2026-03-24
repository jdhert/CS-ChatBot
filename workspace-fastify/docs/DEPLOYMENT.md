# Deployment Strategy (AI Core)

## Recommended rollout path

1. Run as an independent service first (no web-service prompt coupling).
2. Validate `/health`, `/chat`, `/retrieval/search` by Postman/curl.
3. Enable web-service integration after contract tests pass.

## Recommended production shape

- App: `workspace-fastify` (Node 20)
- Source DB: external MariaDB
- Vector DB: external PostgreSQL + pgvector
- Secrets: environment variables from secret manager (not from git)

## Option A (fastest): single VM + process manager

- Build once: `npm ci && npm run build`
- Run via process manager (`pm2` or `systemd`)
- Reverse proxy with Nginx
- Use this when traffic is low and team is small.

## Option B (recommended): Docker image + orchestrator

- Build container image from `workspace-fastify`
- Run with ECS/Kubernetes/App Service equivalent
- Use rolling deploy with health check gate (`/health`)
- Keep MariaDB/PostgreSQL as managed services

## Minimum operational checks

- Liveness endpoint: `GET /health`
- Readiness fields in health payload: `sourceDb`, `vectorDb`, `llm`
- Structured logs with request id and error category
- Alert on:
  - health failures
  - ingest job failures
  - vector query latency spikes

## CI/CD baseline

1. install -> typecheck -> build
2. run contract tests
3. build image artifact
4. deploy to staging
5. smoke test (`/health`, sample `/chat`)
6. production rollout
