/**
 * 자동 인제스트 스케줄러
 *
 * 서버 기동 시 호출하면:
 * 1. 즉시 1회 실행 (미임베딩 청크가 있는 경우만)
 * 2. 이후 INGEST_INTERVAL_HOURS 주기로 반복 실행
 *
 * 환경 변수:
 *   INGEST_AUTO_ENABLED       - "true" 일 때만 활성화 (기본: false)
 *   INGEST_INTERVAL_HOURS     - 실행 주기 시간 (기본: 6)
 *   INGEST_BATCH_SIZE         - 배치 크기 (기본: 50)
 *   INGEST_MAX_BATCHES        - 최대 배치 수 (기본: 10)
 *   EMBEDDING_PROVIDER        - "google" | "openai" (기본: google)
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getVectorPool } from "../db/vectorClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "../../../scripts/sync-scc-embeddings.mjs");

function parseEnvInt(key: string, fallback: number): number {
  const v = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isNaN(v) ? fallback : v;
}

/** 미임베딩 청크 수 조회 */
async function countUnembedded(): Promise<number> {
  const pool = getVectorPool();
  const provider = (process.env.EMBEDDING_PROVIDER ?? "google").toLowerCase();
  const model =
    provider === "google"
      ? (process.env.GOOGLE_EMBEDDING_MODEL ?? "gemini-embedding-2-preview")
      : (process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small");
  const embeddingModel = `${provider}:${model}`;

  try {
    const result = await pool.query<{ cnt: string }>(
      `select count(*) as cnt
         from ai_core.v_scc_chunk_preview v
        where not exists (
          select 1 from ai_core.scc_chunk_embeddings e
           where e.chunk_id = v.chunk_id
             and e.embedding_model = $1
        )`,
      [embeddingModel]
    );
    return Number.parseInt(result.rows[0]?.cnt ?? "0", 10);
  } catch {
    return -1; // DB 오류 시 실행 여부를 알 수 없으므로 -1 반환
  }
}

/** sync-scc-embeddings.mjs 스크립트를 child process로 실행 */
function runIngestScript(logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }): void {
  const batchSize = parseEnvInt("INGEST_BATCH_SIZE", 50);
  const maxBatches = parseEnvInt("INGEST_MAX_BATCHES", 10);
  const provider = process.env.EMBEDDING_PROVIDER ?? "google";

  const args = [
    SCRIPT_PATH,
    "--provider", provider,
    "--batch-size", String(batchSize),
    "--max-batches", String(maxBatches),
  ];

  logger.info(`[ingestScheduler] Starting sync: provider=${provider} batchSize=${batchSize} maxBatches=${maxBatches}`);

  const child = spawn(process.execPath, args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) logger.info(`[ingest] ${line}`);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) logger.warn(`[ingest:stderr] ${line}`);
  });

  child.on("close", (code) => {
    if (code === 0) {
      logger.info(`[ingestScheduler] Sync completed successfully`);
    } else {
      logger.error(`[ingestScheduler] Sync exited with code ${code}`);
    }
  });

  child.on("error", (err) => {
    logger.error(`[ingestScheduler] Failed to start sync process: ${err.message}`);
  });
}

export interface IngestSchedulerHandle {
  stop: () => void;
}

export function startIngestScheduler(logger: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}): IngestSchedulerHandle {
  const enabled = (process.env.INGEST_AUTO_ENABLED ?? "false").trim().toLowerCase() === "true";

  if (!enabled) {
    logger.info("[ingestScheduler] Auto-ingest disabled (INGEST_AUTO_ENABLED != true)");
    return { stop: () => {} };
  }

  const intervalHours = parseEnvInt("INGEST_INTERVAL_HOURS", 6);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  // 즉시 1회 실행 (미임베딩 청크 있을 때만)
  void countUnembedded().then((cnt) => {
    if (cnt === 0) {
      logger.info("[ingestScheduler] No unembedded chunks found — skipping initial sync");
    } else {
      logger.info(`[ingestScheduler] Found ${cnt < 0 ? "unknown" : cnt} unembedded chunks — starting initial sync`);
      runIngestScript(logger);
    }
  });

  // 주기적 실행
  const timer = setInterval(() => {
    void countUnembedded().then((cnt) => {
      if (cnt === 0) {
        logger.info("[ingestScheduler] Scheduled check: no unembedded chunks, skipping");
        return;
      }
      logger.info(`[ingestScheduler] Scheduled sync triggered (unembedded: ${cnt < 0 ? "unknown" : cnt})`);
      runIngestScript(logger);
    });
  }, intervalMs);

  timer.unref?.();

  logger.info(`[ingestScheduler] Scheduler started — interval: ${intervalHours}h`);

  return {
    stop: () => {
      clearInterval(timer);
      logger.info("[ingestScheduler] Scheduler stopped");
    },
  };
}
