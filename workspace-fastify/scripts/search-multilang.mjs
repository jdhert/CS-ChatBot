#!/usr/bin/env node
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: 'DB_HOST_REMOVED',
  port: 5432,
  database: 'ai2',
  user: 'novian',
  password: 'REMOVED'
});

async function searchMultilang() {
  const client = await pool.connect();

  try {
    console.log('=== "다국어" 키워드 검색 ===\n');

    const result1 = await client.query(`
      SELECT chunk_id, chunk_type, LEFT(chunk_text, 150) as text_preview
      FROM ai_core.v_scc_chunk_preview
      WHERE chunk_text ILIKE '%다국어%'
      LIMIT 10
    `);

    console.log(`📊 "다국어" 결과: ${result1.rows.length}개`);
    result1.rows.forEach((row, i) => {
      console.log(`\n[${i+1}] ${row.chunk_type}`);
      console.log(`    ${row.text_preview}...`);
    });

    console.log('\n\n=== "코드" 키워드 검색 ===\n');

    const result2 = await client.query(`
      SELECT chunk_id, chunk_type, LEFT(chunk_text, 150) as text_preview
      FROM ai_core.v_scc_chunk_preview
      WHERE chunk_text ILIKE '%코드%'
      LIMIT 10
    `);

    console.log(`📊 "코드" 결과: ${result2.rows.length}개`);
    result2.rows.forEach((row, i) => {
      console.log(`\n[${i+1}] ${row.chunk_type}`);
      console.log(`    ${row.text_preview}...`);
    });

    console.log('\n\n=== "언어" 키워드 검색 ===\n');

    const result3 = await client.query(`
      SELECT chunk_id, chunk_type, LEFT(chunk_text, 150) as text_preview
      FROM ai_core.v_scc_chunk_preview
      WHERE chunk_text ILIKE '%언어%'
      LIMIT 10
    `);

    console.log(`📊 "언어" 결과: ${result3.rows.length}개`);
    result3.rows.forEach((row, i) => {
      console.log(`\n[${i+1}] ${row.chunk_type}`);
      console.log(`    ${row.text_preview}...`);
    });

    console.log('\n\n=== 전체 통계 ===');
    const stats = await client.query(`
      SELECT
        chunk_type,
        COUNT(*) as count
      FROM ai_core.v_scc_chunk_preview
      GROUP BY chunk_type
      ORDER BY count DESC
    `);

    console.log('\n청크 타입별 데이터 수:');
    stats.rows.forEach(s => {
      console.log(`  ${s.chunk_type}: ${s.count}개`);
    });

  } catch (err) {
    console.error('❌ 에러:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

searchMultilang().catch(err => {
  console.error(err);
  process.exit(1);
});
