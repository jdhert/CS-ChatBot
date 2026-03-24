import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runChatSearchDebug } from "../dist/modules/chat/chat.service.js";
import { closeVectorPool } from "../dist/platform/db/vectorClient.js";

const DEFAULT_DATASET = "docs/eval/scc_eval_set.seed.json";

function parseArgs(argv) {
  const args = {
    dataset: DEFAULT_DATASET,
    limit: null,
    ids: null,
    output: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dataset" && argv[index + 1]) {
      args.dataset = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--limit" && argv[index + 1]) {
      const parsed = Number.parseInt(argv[index + 1], 10);
      args.limit = Number.isFinite(parsed) ? parsed : null;
      index += 1;
      continue;
    }
    if (value === "--ids" && argv[index + 1]) {
      args.ids = new Set(argv[index + 1].split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (value === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function pct(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return round2((numerator / denominator) * 100);
}

function parseDelayMs() {
  const raw = process.env.EVAL_QUERY_DELAY_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const embeddingProvider = (process.env.EMBEDDING_PROVIDER ?? "").toLowerCase();
  return embeddingProvider === "google" ? 1200 : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFailureCase(item, debug) {
  return {
    id: item.id,
    query: item.query,
    expectedRequireId: item.expectedRequireId,
    acceptedRequireIds: item.acceptedRequireIds ?? [],
    actualBestRequireId: debug.bestRequireId,
    actualBestSccId: debug.bestSccId,
    actualBestChunkType: debug.bestChunkType,
    confidence: debug.confidence,
    top3RequireIds: debug.candidates.slice(0, 3).map((candidate) => candidate.requireId),
    retrievalMode: debug.retrievalMode,
    vectorUsed: debug.vectorUsed,
    vectorError: debug.vectorError,
    timings: debug.timings
  };
}

function getAcceptedRequireIds(item) {
  return [
    item.expectedRequireId ?? null,
    ...((Array.isArray(item.acceptedRequireIds) ? item.acceptedRequireIds : []).filter(Boolean))
  ].filter(Boolean);
}

async function loadDataset(datasetPath) {
  const absolutePath = path.resolve(datasetPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("dataset must be a JSON array");
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = await loadDataset(args.dataset);
  const delayMs = parseDelayMs();
  const selected = dataset
    .filter((item) => (args.ids ? args.ids.has(item.id) : true))
    .slice(0, args.limit ?? dataset.length);

  const summary = {
    total: selected.length,
    answerable: 0,
    unanswerable: 0,
    top1Hits: 0,
    top3Hits: 0,
    chunkTypeHits: 0,
    negativeCorrect: 0,
    ruleOnlyCount: 0,
    hybridCount: 0,
    vectorUsedCount: 0,
    failures: []
  };

  for (const item of selected) {
    const debug = await runChatSearchDebug(item.query, item.retrievalScope ?? "scc");
    const expectedRequireId = item.expectedRequireId ?? null;
    const acceptedRequireIds = getAcceptedRequireIds(item);
    const actualBestRequireId = debug.bestRequireId ?? null;
    const top3RequireIds = debug.candidates.slice(0, 3).map((candidate) => candidate.requireId);

    if (item.answerable) {
      summary.answerable += 1;
      if (acceptedRequireIds.includes(actualBestRequireId)) {
        summary.top1Hits += 1;
      } else {
        summary.failures.push(toFailureCase(item, debug));
      }
      if (acceptedRequireIds.some((requireId) => top3RequireIds.includes(requireId))) {
        summary.top3Hits += 1;
      }
      if (item.expectedChunkType && debug.bestChunkType === item.expectedChunkType) {
        summary.chunkTypeHits += 1;
      }
    } else {
      summary.unanswerable += 1;
      if (actualBestRequireId === null) {
        summary.negativeCorrect += 1;
      } else {
        summary.failures.push(toFailureCase(item, debug));
      }
    }

    if (debug.retrievalMode === "hybrid") {
      summary.hybridCount += 1;
    } else {
      summary.ruleOnlyCount += 1;
    }
    if (debug.vectorUsed) {
      summary.vectorUsedCount += 1;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: path.resolve(args.dataset),
    total: summary.total,
    answerable: summary.answerable,
    unanswerable: summary.unanswerable,
    metrics: {
      top1Hit: `${summary.top1Hits}/${summary.answerable} (${pct(summary.top1Hits, summary.answerable)}%)`,
      top3Hit: `${summary.top3Hits}/${summary.answerable} (${pct(summary.top3Hits, summary.answerable)}%)`,
      policyMode: "expectedRequireId_or_acceptedRequireIds",
      chunkTypeHit: `${summary.chunkTypeHits}/${summary.answerable} (${pct(summary.chunkTypeHits, summary.answerable)}%)`,
      negativeCorrect: `${summary.negativeCorrect}/${summary.unanswerable} (${pct(summary.negativeCorrect, summary.unanswerable)}%)`
    },
    runtime: {
      delayMs,
      ruleOnlyCount: summary.ruleOnlyCount,
      hybridCount: summary.hybridCount,
      vectorUsedCount: summary.vectorUsedCount
    },
    failures: summary.failures.slice(0, 20)
  };

  if (args.output) {
    await fs.writeFile(path.resolve(args.output), JSON.stringify(report, null, 2), "utf8");
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("[error] evaluation failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeVectorPool();
  });
