#!/usr/bin/env node
import "dotenv/config";
import { createPool } from "./db-config.mjs";

const pool = createPool();

async function checkChunkStability() {
  try {
    console.log("=== Checking v_scc_chunk_preview stability ===\n");

    // 1. Row counts
    console.log("1. Row Counts:");
    const previewCount = await pool.query(
      "select count(*) as count from ai_core.v_scc_chunk_preview"
    );
    const embeddingCount = await pool.query(
      "select count(*) as count from ai_core.scc_chunk_embeddings"
    );
    console.log(`  v_scc_chunk_preview: ${previewCount.rows[0].count}`);
    console.log(`  scc_chunk_embeddings: ${embeddingCount.rows[0].count}\n`);

    // 2. chunk_id 중복 검사
    console.log("2. Checking for duplicate chunk_ids:");
    const duplicates = await pool.query(`
      select chunk_id, count(*) as dup_count
      from ai_core.v_scc_chunk_preview
      group by chunk_id
      having count(*) > 1
      limit 10
    `);
    if (duplicates.rows.length === 0) {
      console.log("  ✅ No duplicate chunk_ids found\n");
    } else {
      console.log(`  ⚠️  Found ${duplicates.rows.length} duplicate chunk_ids:`);
      duplicates.rows.forEach(row => {
        console.log(`    ${row.chunk_id}: ${row.dup_count} times`);
      });
      console.log();
    }

    // 3. chunk_id stability test (두 번 조회해서 같은지 확인)
    console.log("3. Testing chunk_id stability (same query twice):");
    const first = await pool.query(`
      select chunk_id, require_id, chunk_type, chunk_seq
      from ai_core.v_scc_chunk_preview
      order by require_id, chunk_type, chunk_seq
      limit 5
    `);
    const second = await pool.query(`
      select chunk_id, require_id, chunk_type, chunk_seq
      from ai_core.v_scc_chunk_preview
      order by require_id, chunk_type, chunk_seq
      limit 5
    `);

    let stable = true;
    for (let i = 0; i < first.rows.length; i++) {
      if (first.rows[i].chunk_id !== second.rows[i].chunk_id) {
        stable = false;
        console.log(`  ⚠️  chunk_id changed between queries at index ${i}`);
        console.log(`    First:  ${first.rows[i].chunk_id}`);
        console.log(`    Second: ${second.rows[i].chunk_id}`);
      }
    }
    if (stable) {
      console.log("  ✅ chunk_ids are stable (identical in both queries)\n");
    } else {
      console.log("  ❌ chunk_ids are NOT stable\n");
    }

    // 4. Matching status with embeddings
    console.log("4. Matching with scc_chunk_embeddings:");
    const matching = await pool.query(`
      select
        (select count(*) from ai_core.v_scc_chunk_preview) as preview_total,
        (select count(*) from ai_core.scc_chunk_embeddings) as embedding_total,
        count(*) as matched_count
      from ai_core.v_scc_chunk_preview v
      where exists (
        select 1
        from ai_core.scc_chunk_embeddings e
        where e.chunk_id = v.chunk_id
      )
    `);
    const m = matching.rows[0];
    console.log(`  Preview total: ${m.preview_total}`);
    console.log(`  Embedding total: ${m.embedding_total}`);
    console.log(`  Matched: ${m.matched_count}`);
    console.log(`  Coverage: ${((m.matched_count / m.preview_total) * 100).toFixed(2)}%\n`);

    // 5. Unmatched chunks (preview에는 있는데 embedding에 없는 것)
    console.log("5. Unmatched chunks (in preview but not in embeddings):");
    const unmatched = await pool.query(`
      select chunk_id, require_id, chunk_type, chunk_seq
      from ai_core.v_scc_chunk_preview v
      where not exists (
        select 1
        from ai_core.scc_chunk_embeddings e
        where e.chunk_id = v.chunk_id
      )
      limit 10
    `);
    if (unmatched.rows.length === 0) {
      console.log("  ✅ All preview chunks have embeddings\n");
    } else {
      console.log(`  Found ${unmatched.rows.length} unmatched chunks (showing first 10):`);
      unmatched.rows.forEach(row => {
        console.log(`    ${row.chunk_id} - ${row.require_id} (${row.chunk_type})`);
      });
      console.log();
    }

    // 6. Stale embeddings (embedding에는 있는데 preview에 없는 것)
    console.log("6. Stale embeddings (in embeddings but not in preview):");
    const stale = await pool.query(`
      select chunk_id
      from ai_core.scc_chunk_embeddings e
      where not exists (
        select 1
        from ai_core.v_scc_chunk_preview v
        where v.chunk_id = e.chunk_id
      )
      limit 10
    `);
    if (stale.rows.length === 0) {
      console.log("  ✅ No stale embeddings\n");
    } else {
      console.log(`  ⚠️  Found ${stale.rows.length} stale embeddings (showing first 10):`);
      stale.rows.forEach(row => {
        console.log(`    ${row.chunk_id}`);
      });
      console.log();
    }

  } catch (error) {
    console.error("Error:", error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

checkChunkStability().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
