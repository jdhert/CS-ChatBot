# Workspace Boundaries

This repository is the active development workspace for Fastify + TypeScript migration.

## Scope

- Allowed: new implementation, tests, docs, migration tooling inside `workspace-fastify/`.
- Not allowed: direct development inside legacy Express source tree.

## Hard Rules

1. No direct import from legacy code
   - Forbidden examples:
     - `import x from "../legacy-express/..."`
     - `import x from "../../src/..."` (legacy root coupling)
2. No shared runtime state with legacy
   - Do not share `node_modules`, `.env`, database files, local storage directories.
3. No secret commit
   - Never commit real credentials, certificates, private keys.
4. Contract-first migration
   - Endpoint migration must pass parity checks against legacy behavior before cutover.
5. One-way reference usage
   - Legacy is read-only reference. Re-implement or wrap behavior; do not copy large opaque blocks.

## Directory Contract

- `src/`: new Fastify + TypeScript application code.
- `tests/contract/`: parity tests for migrated endpoints.
- `tests/integration/`: integration tests for new workspace runtime.
- `docs/`: migration notes and decision records.
- `scripts/`: local migration/test helper scripts.

## Hotfix Decision Rule

For every production hotfix during migration, record one of:

- `legacy-only`
- `workspace-only`
- `both`

Then log the reason and follow-up action in `MIGRATION_LOG.md`.

## Cutover Gate (per endpoint)

An endpoint can move to workspace runtime only when all are true:

- parity test pass
- error shape confirmed
- auth behavior confirmed
- rollback method documented
