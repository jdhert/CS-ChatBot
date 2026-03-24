# Migration Log

Track endpoint-by-endpoint migration decisions and parity status.

## Status Legend

- `planned`: not started
- `in-progress`: implementation/testing ongoing
- `parity-passed`: contract parity passed
- `cutover-done`: traffic switched to workspace
- `rolled-back`: switched back to legacy

## Entry Template

| Date (KST) | Scope | Change Type | Status | Owner | Notes |
|---|---|---|---|---|---|
| YYYY-MM-DD HH:mm | `/v3/...` | legacy-only \| workspace-only \| both | planned | name | reason, risks, links |

## Log Entries

| Date (KST) | Scope | Change Type | Status | Owner | Notes |
|---|---|---|---|---|---|
| 2026-03-05 00:00 | workspace bootstrap | workspace-only | planned | TBD | Initialized workspace structure and policy documents |
