#!/usr/bin/env node
/**
 * export-eval-candidates.mjs
 *
 * query_log에서 실패/싫어요/결과 없음/저신뢰 케이스를 평가셋 후보로 추출합니다.
 * 산출물은 바로 seed에 병합하지 않고 manualReviewRequired=true 상태로 저장합니다.
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

const DEFAULT_OUTPUT = "docs/eval/query_log_eval_candidates.latest.json";

function parsePort(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseNumber(raw, fallback) {
  const parsed = Number.parseFloat(raw ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPool() {
  return new Pool({
    host: process.env.VECTOR_DB_HOST ?? "localhost",
    port: parsePort(process.env.VECTOR_DB_PORT, 5432),
    database: process.env.VECTOR_DB_NAME ?? "ai2",
    user: process.env.VECTOR_DB_USER,
    password: process.env.VECTOR_DB_PASSWORD,
    ssl: process.env.VECTOR_DB_SSL === "true",
  });
}

function parseArgs(argv) {
  const args = {
    days: 14,
    limit: 50,
    minConfidence: 0.45,
    output: process.env.EVAL_CANDIDATE_OUTPUT ?? DEFAULT_OUTPUT,
    includeSlow: false,
    slowMs: 8_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--days" && argv[index + 1]) {
      args.days = parseInteger(argv[index + 1], args.days);
      index += 1;
      continue;
    }
    if (value === "--limit" && argv[index + 1]) {
      args.limit = parseInteger(argv[index + 1], args.limit);
      index += 1;
      continue;
    }
    if (value === "--min-confidence" && argv[index + 1]) {
      args.minConfidence = parseNumber(argv[index + 1], args.minConfidence);
      index += 1;
      continue;
    }
    if (value === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--include-slow") {
      args.includeSlow = true;
      continue;
    }
    if (value === "--slow-ms" && argv[index + 1]) {
      args.slowMs = parseInteger(argv[index + 1], args.slowMs);
      index += 1;
    }
  }

  return args;
}

function buildReasonTags(row, minConfidence, includeSlow, slowMs) {
  const tags = [];
  if (row.user_feedback === "down") tags.push("feedback_down");
  if (row.is_failure) tags.push("failure");
  if (row.is_no_match) tags.push("no_match");
  if (typeof row.confidence === "number" && row.confidence < minConfidence) tags.push("low_confidence");
  if (includeSlow && Number(row.total_ms ?? 0) >= slowMs) tags.push("slow");
  return tags;
}

function buildPriorityScore(tags) {
  let score = 0;
  if (tags.includes("feedback_down")) score += 100;
  if (tags.includes("failure")) score += 80;
  if (tags.includes("no_match")) score += 60;
  if (tags.includes("low_confidence")) score += 30;
  if (tags.includes("slow")) score += 10;
  return score;
}

function normalizeQuery(query) {
  return String(query ?? "").replace(/\s+/g, " ").trim();
}

function buildCandidateId(index) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `QL-${date}-${String(index + 1).padStart(3, "0")}`;
}

function toCandidate(row, index, args) {
  const tags = buildReasonTags(row, args.minConfidence, args.includeSlow, args.slowMs);
  const query = normalizeQuery(row.query);
  const retrievalScope = row.retrieval_scope ?? "all";
  const observedRequireId = row.best_require_id ?? null;
  const observedSccId = row.best_scc_id ? String(row.best_scc_id) : null;
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? "");

  return {
    id: buildCandidateId(index),
    query,
    retrievalScope,
    manualReviewRequired: true,
    reasonTags: tags,
    priorityScore: buildPriorityScore(tags),
    notes: "운영 query_log에서 자동 추출된 eval 후보입니다. expectedRequireId/answerable 판정 후 seed로 승격하세요.",
    observed: {
      logUuid: row.log_uuid,
      createdAt,
      confidence: row.confidence,
      bestRequireId: observedRequireId,
      bestSccId: observedSccId,
      chunkType: row.chunk_type ?? null,
      retrievalMode: row.retrieval_mode ?? null,
      answerSource: row.answer_source ?? null,
      userFeedback: row.user_feedback ?? null,
      isFailure: Boolean(row.is_failure),
      failureReason: row.failure_reason ?? null,
      isNoMatch: Boolean(row.is_no_match),
      totalMs: row.total_ms ?? null,
    },
    draftEvalItem: {
      id: buildCandidateId(index).replace("QL-", "EV-CAND-"),
      query,
      retrievalScope,
      expectedRequireId: observedRequireId,
      expectedSccId: observedSccId,
      expectedChunkType: row.chunk_type ?? null,
      answerable: !row.is_no_match,
      tags: ["candidate", ...tags],
      notes: "자동 후보입니다. 운영 로그와 유사 이력 확인 후 expected* 값을 확정하세요.",
    },
  };
}

async function queryCandidateRows(pool, args) {
  const params = [args.days, args.minConfidence];
  let slowCondition = "";
  if (args.includeSlow) {
    params.push(args.slowMs);
    slowCondition = `or coalesce(total_ms, 0) >= $${params.length}`;
  }
  params.push(args.limit * 4);
  const limitParamIndex = params.length;

  const result = await pool.query(
    `select
        log_uuid::text,
        query,
        retrieval_scope,
        confidence::float as confidence,
        best_require_id::text,
        best_scc_id::text,
        chunk_type,
        retrieval_mode,
        answer_source,
        user_feedback,
        is_failure,
        failure_reason,
        is_no_match,
        total_ms::int as total_ms,
        created_at
       from ai_core.query_log
      where created_at >= now() - ($1::int * interval '1 day')
        and trim(coalesce(query, '')) <> ''
        and (
          user_feedback = 'down'
          or is_failure = true
          or is_no_match = true
          or confidence < $2
          ${slowCondition}
        )
      order by
        case when user_feedback = 'down' then 0 else 1 end,
        case when is_failure = true then 0 else 1 end,
        case when is_no_match = true then 0 else 1 end,
        confidence nulls first,
        created_at desc
      limit $${limitParamIndex}`,
    params
  );

  return result.rows;
}

function dedupeCandidates(rows, args) {
  const byQuery = new Map();
  for (const row of rows) {
    const query = normalizeQuery(row.query);
    if (!query) continue;

    const tags = buildReasonTags(row, args.minConfidence, args.includeSlow, args.slowMs);
    const priorityScore = buildPriorityScore(tags);
    const current = byQuery.get(query);
    const currentTags = current
      ? buildReasonTags(current, args.minConfidence, args.includeSlow, args.slowMs)
      : [];
    const currentScore = current ? buildPriorityScore(currentTags) : -1;

    if (!current || priorityScore > currentScore || new Date(row.created_at) > new Date(current.created_at)) {
      byQuery.set(query, row);
    }
  }

  return Array.from(byQuery.values())
    .map((row, index) => toCandidate(row, index, args))
    .sort((a, b) => b.priorityScore - a.priorityScore || b.observed.createdAt.localeCompare(a.observed.createdAt))
    .slice(0, args.limit)
    .map((candidate, index) => ({
      ...candidate,
      id: buildCandidateId(index),
      draftEvalItem: {
        ...candidate.draftEvalItem,
        id: buildCandidateId(index).replace("QL-", "EV-CAND-"),
      },
    }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = getPool();

  try {
    const rows = await queryCandidateRows(pool, args);
    const candidates = dedupeCandidates(rows, args);
    const report = {
      generatedAt: new Date().toISOString(),
      source: "ai_core.query_log",
      selection: {
        days: args.days,
        limit: args.limit,
        minConfidence: args.minConfidence,
        includeSlow: args.includeSlow,
        slowMs: args.slowMs,
      },
      rawRows: rows.length,
      candidateCount: candidates.length,
      reasonSummary: candidates.reduce((acc, candidate) => {
        for (const tag of candidate.reasonTags) {
          acc[tag] = (acc[tag] ?? 0) + 1;
        }
        return acc;
      }, {}),
      candidates,
    };

    const outputPath = path.resolve(args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] failed to export eval candidates");
  console.error(error);
  process.exitCode = 1;
});
