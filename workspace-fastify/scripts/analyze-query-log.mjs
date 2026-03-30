#!/usr/bin/env node
/**
 * analyze-query-log.mjs
 *
 * ai_core.query_log 테이블을 분석해서 검색 품질 리포트를 출력합니다.
 *
 * 사용법:
 *   node scripts/analyze-query-log.mjs              # 최근 7일
 *   node scripts/analyze-query-log.mjs --days 30    # 최근 30일
 *   node scripts/analyze-query-log.mjs --no-match   # no-match 케이스만 출력
 */

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
    ssl: process.env.VECTOR_DB_SSL === "true",
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const days = (() => {
    const i = args.indexOf("--days");
    return i >= 0 ? parseInt(args[i + 1] ?? "7", 10) : 7;
  })();
  const noMatchOnly = args.includes("--no-match");
  return { days, noMatchOnly };
}

function pad(str, len) {
  return String(str ?? "").slice(0, len).padEnd(len);
}

function hr(char = "─", len = 70) {
  return char.repeat(len);
}

async function main() {
  const { days, noMatchOnly } = parseArgs();
  const pool = getPool();

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  쿼리 로그 분석 리포트  (최근 ${days}일)`);
  console.log(`${"═".repeat(70)}\n`);

  try {
    // ── 1. 전체 통계 ──────────────────────────────────────────────────────────
    if (!noMatchOnly) {
      const summary = await pool.query(`
        select
          count(*)                                              as total,
          count(*) filter (where is_no_match)                  as no_match_count,
          round(100.0 * count(*) filter (where is_no_match)
                / nullif(count(*),0), 1)                       as no_match_pct,
          round(avg(confidence) filter (where not is_no_match), 4) as avg_confidence,
          round(avg(total_ms), 0)                              as avg_total_ms,
          round(avg(embedding_ms), 0)                         as avg_embedding_ms,
          round(avg(retrieval_ms), 0)                         as avg_retrieval_ms,
          count(*) filter (where vector_used)                  as vector_used_count,
          count(*) filter (where retrieval_mode = 'hybrid')    as hybrid_count,
          count(*) filter (where user_feedback = 'up')         as feedback_up,
          count(*) filter (where user_feedback = 'down')       as feedback_down
        from ai_core.query_log
        where created_at >= now() - ($1 || ' days')::interval
      `, [days]);

      const s = summary.rows[0];
      console.log("【 전체 통계 】");
      console.log(`  총 쿼리 수       : ${s.total}`);
      console.log(`  no-match 수      : ${s.no_match_count}  (${s.no_match_pct ?? 0}%)`);
      console.log(`  평균 confidence  : ${s.avg_confidence ?? "─"}`);
      console.log(`  평균 응답시간    : ${s.avg_total_ms ?? "─"}ms  (embedding: ${s.avg_embedding_ms ?? "─"}ms, retrieval: ${s.avg_retrieval_ms ?? "─"}ms)`);
      console.log(`  벡터 사용        : ${s.vector_used_count}  /  hybrid: ${s.hybrid_count}`);
      console.log(`  피드백 👍        : ${s.feedback_up}  👎: ${s.feedback_down}`);

      // ── 2. 검색 모드 분포 ──────────────────────────────────────────────────
      const modes = await pool.query(`
        select retrieval_mode, count(*) as cnt
        from ai_core.query_log
        where created_at >= now() - ($1 || ' days')::interval
          and retrieval_mode is not null
        group by retrieval_mode
        order by cnt desc
      `, [days]);

      if (modes.rows.length > 0) {
        console.log(`\n${hr()}`);
        console.log("【 검색 모드 분포 】");
        for (const r of modes.rows) {
          console.log(`  ${pad(r.retrieval_mode, 20)} : ${r.cnt}`);
        }
      }

      // ── 3. 답변 소스 분포 ─────────────────────────────────────────────────
      const sources = await pool.query(`
        select answer_source, count(*) as cnt
        from ai_core.query_log
        where created_at >= now() - ($1 || ' days')::interval
          and answer_source is not null
        group by answer_source
        order by cnt desc
      `, [days]);

      if (sources.rows.length > 0) {
        console.log(`\n${hr()}`);
        console.log("【 답변 소스 분포 】");
        for (const r of sources.rows) {
          console.log(`  ${pad(r.answer_source, 25)} : ${r.cnt}`);
        }
      }

      // ── 4. 느린 쿼리 Top 5 ───────────────────────────────────────────────
      const slow = await pool.query(`
        select query, total_ms, embedding_ms, retrieval_mode, confidence, created_at
        from ai_core.query_log
        where created_at >= now() - ($1 || ' days')::interval
          and total_ms is not null
        order by total_ms desc
        limit 5
      `, [days]);

      if (slow.rows.length > 0) {
        console.log(`\n${hr()}`);
        console.log("【 느린 쿼리 Top 5 】");
        for (const r of slow.rows) {
          const ts = new Date(r.created_at).toLocaleString("ko-KR");
          console.log(`  [${r.total_ms}ms]  ${pad(r.query, 40)}  (${r.retrieval_mode ?? "─"})  ${ts}`);
        }
      }

      // ── 5. 부정적 피드백 쿼리 ────────────────────────────────────────────
      const negFeedback = await pool.query(`
        select query, confidence, retrieval_mode, answer_source, created_at
        from ai_core.query_log
        where created_at >= now() - ($1 || ' days')::interval
          and user_feedback = 'down'
        order by created_at desc
        limit 20
      `, [days]);

      if (negFeedback.rows.length > 0) {
        console.log(`\n${hr()}`);
        console.log("【 👎 부정적 피드백 쿼리 】");
        for (const r of negFeedback.rows) {
          const ts = new Date(r.created_at).toLocaleString("ko-KR");
          console.log(`  [${pad(r.confidence ?? "─", 6)}]  ${pad(r.query, 45)}  ${ts}`);
        }
      }
    }

    // ── 6. no-match 쿼리 (개선 대상) ─────────────────────────────────────
    const noMatchRows = await pool.query(`
      select query, confidence, created_at
      from ai_core.query_log
      where created_at >= now() - ($1 || ' days')::interval
        and is_no_match = true
      order by created_at desc
      limit 30
    `, [days]);

    if (noMatchRows.rows.length > 0) {
      console.log(`\n${hr()}`);
      console.log("【 no-match 쿼리 (도메인 어휘 추가 대상) 】");
      for (const r of noMatchRows.rows) {
        const ts = new Date(r.created_at).toLocaleString("ko-KR");
        console.log(`  [conf:${pad(r.confidence ?? "─", 6)}]  ${pad(r.query, 50)}  ${ts}`);
      }
    } else {
      console.log(`\n${hr()}`);
      console.log("【 no-match 쿼리 】  → 해당 기간 내 no-match 없음 ✓");
    }

    console.log(`\n${"═".repeat(70)}\n`);
  } catch (err) {
    console.error("[error]", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
