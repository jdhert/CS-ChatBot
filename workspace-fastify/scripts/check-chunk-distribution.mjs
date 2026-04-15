#!/usr/bin/env node
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function main() {
  const pool = new Pool({
    host: process.env.VECTOR_DB_HOST ?? "localhost",
    port: Number.parseInt(process.env.VECTOR_DB_PORT ?? "5432", 10),
    database: process.env.VECTOR_DB_NAME ?? "ai2",
    user: process.env.VECTOR_DB_USER,
    password: process.env.VECTOR_DB_PASSWORD,
    ssl: process.env.VECTOR_DB_SSL === "true"
  });

  try {
    // scc_id당 chunk_type별 개수 확인
    const countByType = await pool.query(`
      SELECT
        scc_id,
        COUNT(*) FILTER (WHERE chunk_type = 'issue') as issue_count,
        COUNT(*) FILTER (WHERE chunk_type = 'action') as action_count,
        COUNT(*) FILTER (WHERE chunk_type = 'resolution') as resolution_count,
        COUNT(*) FILTER (WHERE chunk_type = 'qa_pair') as qa_pair_count,
        SUM(LENGTH(chunk_text)) FILTER (WHERE chunk_type = 'action') as total_action_length
      FROM ai_core.scc_chunk_embeddings
      GROUP BY scc_id
      HAVING COUNT(*) FILTER (WHERE chunk_type = 'action') > 0
      ORDER BY action_count DESC
      LIMIT 20
    `);

    console.log("=== scc_id당 chunk 구성 (action이 있는 경우, 상위 20개) ===");
    for (const row of countByType.rows) {
      console.log(
        `scc_id=${row.scc_id}: issue=${row.issue_count}, action=${row.action_count}, ` +
        `resolution=${row.resolution_count}, qa_pair=${row.qa_pair_count}, ` +
        `total_action_length=${row.total_action_length || 0}자`
      );
    }

    // 전체 통계
    const stats = await pool.query(`
      WITH scc_stats AS (
        SELECT
          scc_id,
          COUNT(*) FILTER (WHERE chunk_type = 'action') as action_count,
          SUM(LENGTH(chunk_text)) FILTER (WHERE chunk_type = 'action') as total_action_length,
          SUM(LENGTH(chunk_text)) FILTER (WHERE chunk_type = 'issue') as issue_length
        FROM ai_core.scc_chunk_embeddings
        GROUP BY scc_id
      )
      SELECT
        AVG(action_count)::numeric(10,2) as avg_actions_per_scc,
        MAX(action_count) as max_actions_per_scc,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY action_count)::int as median_actions,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY action_count)::int as p90_actions,
        AVG(total_action_length)::int as avg_total_action_length,
        MAX(total_action_length) as max_total_action_length,
        AVG(issue_length + COALESCE(total_action_length, 0))::int as avg_combined_length,
        MAX(issue_length + COALESCE(total_action_length, 0)) as max_combined_length
      FROM scc_stats
      WHERE action_count > 0
    `);

    console.log("\n=== 전체 통계 (action이 있는 scc_id만) ===");
    console.log(JSON.stringify(stats.rows[0], null, 2));

    // action이 많은 케이스 확인
    const heavyCases = await pool.query(`
      SELECT
        scc_id,
        COUNT(*) FILTER (WHERE chunk_type = 'action') as action_count,
        SUM(LENGTH(chunk_text)) FILTER (WHERE chunk_type = 'action') as total_action_length,
        SUM(LENGTH(chunk_text)) FILTER (WHERE chunk_type = 'issue') as issue_length,
        SUM(LENGTH(chunk_text)) FILTER (WHERE chunk_type = 'issue') +
          COALESCE(SUM(LENGTH(chunk_text)) FILTER (WHERE chunk_type = 'action'), 0) as combined_length
      FROM ai_core.scc_chunk_embeddings
      GROUP BY scc_id
      HAVING COUNT(*) FILTER (WHERE chunk_type = 'action') >= 3
      ORDER BY action_count DESC
      LIMIT 10
    `);

    console.log("\n=== action이 3개 이상인 케이스 (상위 10개) ===");
    for (const row of heavyCases.rows) {
      console.log(
        `scc_id=${row.scc_id}: actions=${row.action_count}, ` +
        `issue_len=${row.issue_length || 0}, total_action_len=${row.total_action_length}, ` +
        `combined=${row.combined_length}자`
      );
    }

    // 분포 확인
    const distribution = await pool.query(`
      WITH scc_stats AS (
        SELECT
          scc_id,
          COUNT(*) FILTER (WHERE chunk_type = 'action') as action_count
        FROM ai_core.scc_chunk_embeddings
        GROUP BY scc_id
      )
      SELECT
        CASE
          WHEN action_count = 0 THEN '0개'
          WHEN action_count = 1 THEN '1개'
          WHEN action_count = 2 THEN '2개'
          WHEN action_count = 3 THEN '3개'
          WHEN action_count BETWEEN 4 AND 5 THEN '4-5개'
          ELSE '6개 이상'
        END as action_count_range,
        COUNT(*) as scc_count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
      FROM scc_stats
      GROUP BY action_count_range
      ORDER BY MIN(action_count)
    `);

    console.log("\n=== scc_id당 action 개수 분포 ===");
    for (const row of distribution.rows) {
      console.log(`${row.action_count_range}: ${row.scc_count}개 (${row.percentage}%)`);
    }

  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error]", error);
  process.exitCode = 1;
});
