#!/usr/bin/env node
/**
 * db-config.mjs
 *
 * 스크립트 공통 DB 연결 설정.
 * VECTOR_DB_PASSWORD 환경변수가 없으면 즉시 에러 처리합니다.
 */

import pg from "pg";
const { Pool } = pg;

function parsePort(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function createPool() {
  const password = process.env.VECTOR_DB_PASSWORD;
  if (!password) {
    console.error(
      "[db-config] VECTOR_DB_PASSWORD 환경변수가 설정되지 않았습니다.\n" +
      "  .env 파일에 VECTOR_DB_PASSWORD=<비밀번호>를 설정하거나\n" +
      "  VECTOR_DB_PASSWORD=<비밀번호> node scripts/<script>.mjs 형태로 실행하세요."
    );
    process.exit(1);
  }

  return new Pool({
    host: process.env.VECTOR_DB_HOST ?? "localhost",
    port: parsePort(process.env.VECTOR_DB_PORT, 5432),
    database: process.env.VECTOR_DB_NAME ?? "ai2",
    user: process.env.VECTOR_DB_USER ?? "novian",
    password,
    ssl: process.env.VECTOR_DB_SSL === "true",
  });
}
