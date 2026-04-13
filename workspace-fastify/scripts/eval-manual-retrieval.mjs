#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runChatSearchDebug } from "../dist/modules/chat/chat.service.js";
import { closeVectorPool } from "../dist/platform/db/vectorClient.js";

const DEFAULT_DATASET = "docs/eval/manual_eval_set.seed.json";
const DEFAULT_OUTPUT = "docs/eval/manual_retrieval.latest.json";

function parseArgs(argv) {
  const args = {
    dataset: DEFAULT_DATASET,
    output: DEFAULT_OUTPUT,
    ids: null,
    limit: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dataset" && argv[index + 1]) {
      args.dataset = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--ids" && argv[index + 1]) {
      args.ids = new Set(argv[index + 1].split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (value === "--limit" && argv[index + 1]) {
      const parsed = Number.parseInt(argv[index + 1], 10);
      args.limit = Number.isFinite(parsed) ? parsed : null;
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
  const raw = process.env.MANUAL_EVAL_DELAY_MS ?? process.env.EVAL_QUERY_DELAY_MS;
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeIncludes(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function getAcceptedProducts(item) {
  return [
    item.expectedProduct ?? null,
    ...((Array.isArray(item.acceptedProducts) ? item.acceptedProducts : []).filter(Boolean))
  ].filter(Boolean);
}

function getAcceptedTitleIncludes(item) {
  return [
    ...normalizeIncludes(item.expectedTitleIncludes),
    ...normalizeIncludes(item.acceptedTitleIncludes)
  ];
}

function hasProductHit(item, topManual) {
  const acceptedProducts = getAcceptedProducts(item);
  if (acceptedProducts.length === 0) {
    return true;
  }
  return topManual !== null && acceptedProducts.includes(topManual.product);
}

function hasTitleHit(item, topManual) {
  const acceptedTitleIncludes = getAcceptedTitleIncludes(item);
  if (acceptedTitleIncludes.length === 0) {
    return true;
  }
  return topManual !== null && acceptedTitleIncludes.some((needle) => topManual.title.includes(needle));
}

function hasScorePass(item, topManual) {
  const minScore = typeof item.minManualScore === "number" ? item.minManualScore : 0.75;
  return topManual !== null && topManual.score >= minScore;
}

function getExpectedBestChunkType(item) {
  if (typeof item.expectedBestChunkType === "string") {
    return item.expectedBestChunkType;
  }
  return item.answerable ? "manual" : null;
}

function hasExpectedClarificationReason(item, debug) {
  if (!item.expectedClarificationReason) {
    return true;
  }
  return debug.manualError === item.expectedClarificationReason;
}

function toCaseResult(item, debug) {
  const topManual = Array.isArray(debug.manualCandidates) && debug.manualCandidates.length > 0
    ? debug.manualCandidates[0]
    : null;
  const expectedBestChunkType = getExpectedBestChunkType(item);
  const bestChunkTypeHit = expectedBestChunkType === null
    ? debug.bestChunkType === null
    : debug.bestChunkType === expectedBestChunkType;
  const manualBestHit = debug.bestChunkType === "manual";
  const clarificationHit = debug.bestChunkType === "manual_clarification";
  const manualCandidateHit = topManual !== null;
  const productHit = hasProductHit(item, topManual);
  const titleHit = hasTitleHit(item, topManual);
  const scorePass = hasScorePass(item, topManual);
  const clarificationReasonHit = hasExpectedClarificationReason(item, debug);
  const manualCasePass =
    bestChunkTypeHit && manualCandidateHit && productHit && titleHit && scorePass;
  const clarificationCasePass =
    bestChunkTypeHit && manualCandidateHit && clarificationReasonHit;
  const negativeCasePass =
    bestChunkTypeHit && !manualBestHit && !clarificationHit;
  const passed = expectedBestChunkType === "manual"
    ? manualCasePass
    : expectedBestChunkType === "manual_clarification"
      ? clarificationCasePass
      : negativeCasePass;

  return {
    id: item.id,
    query: item.query,
    passed,
    answerable: item.answerable,
    expectedBestChunkType,
    expectedClarificationReason: item.expectedClarificationReason ?? null,
    expectedProduct: item.expectedProduct ?? null,
    acceptedProducts: item.acceptedProducts ?? [],
    expectedTitleIncludes: item.expectedTitleIncludes ?? null,
    acceptedTitleIncludes: item.acceptedTitleIncludes ?? [],
    bestChunkTypeHit,
    manualBestHit,
    clarificationHit,
    manualCandidateHit,
    productHit,
    titleHit,
    scorePass,
    clarificationReasonHit,
    actualBestChunkType: debug.bestChunkType,
    confidence: debug.confidence,
    manualError: debug.manualError ?? null,
    manualCandidateCount: debug.manualCandidateCount ?? 0,
    topManual: topManual
      ? {
          documentId: topManual.documentId,
          chunkId: topManual.chunkId,
          score: topManual.score,
          product: topManual.product,
          title: topManual.title,
          version: topManual.version ?? null,
          sectionTitle: topManual.sectionTitle ?? null,
          previewText: topManual.previewText?.slice(0, 220) ?? null
        }
      : null,
    retrievalMode: debug.retrievalMode,
    vectorUsed: debug.vectorUsed,
    vectorError: debug.vectorError,
    timings: debug.timings
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const delayMs = parseDelayMs();
  const dataset = await loadDataset(args.dataset);
  const selected = dataset
    .filter((item) => (args.ids ? args.ids.has(item.id) : true))
    .slice(0, args.limit ?? dataset.length);

  const results = [];

  for (const item of selected) {
    const debug = await runChatSearchDebug(item.query, item.retrievalScope ?? "all");
    results.push(toCaseResult(item, debug));

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const answerable = results.filter((item) => item.answerable);
  const manualExpected = results.filter((item) => item.expectedBestChunkType === "manual");
  const clarificationExpected = results.filter((item) => item.expectedBestChunkType === "manual_clarification");
  const unanswerable = results.filter((item) => !item.answerable);
  const report = {
    generatedAt: new Date().toISOString(),
    dataset: path.resolve(args.dataset),
    total: results.length,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    metrics: {
      passed: `${results.filter((item) => item.passed).length}/${results.length} (${pct(results.filter((item) => item.passed).length, results.length)}%)`,
      bestChunkTypeHit: `${results.filter((item) => item.bestChunkTypeHit).length}/${results.length} (${pct(results.filter((item) => item.bestChunkTypeHit).length, results.length)}%)`,
      manualBestHit: `${manualExpected.filter((item) => item.manualBestHit).length}/${manualExpected.length} (${pct(manualExpected.filter((item) => item.manualBestHit).length, manualExpected.length)}%)`,
      clarificationHit: `${clarificationExpected.filter((item) => item.clarificationHit).length}/${clarificationExpected.length} (${pct(clarificationExpected.filter((item) => item.clarificationHit).length, clarificationExpected.length)}%)`,
      manualCandidateHit: `${answerable.filter((item) => item.manualCandidateHit).length}/${answerable.length} (${pct(answerable.filter((item) => item.manualCandidateHit).length, answerable.length)}%)`,
      productHit: `${manualExpected.filter((item) => item.productHit).length}/${manualExpected.length} (${pct(manualExpected.filter((item) => item.productHit).length, manualExpected.length)}%)`,
      titleHit: `${manualExpected.filter((item) => item.titleHit).length}/${manualExpected.length} (${pct(manualExpected.filter((item) => item.titleHit).length, manualExpected.length)}%)`,
      scorePass: `${manualExpected.filter((item) => item.scorePass).length}/${manualExpected.length} (${pct(manualExpected.filter((item) => item.scorePass).length, manualExpected.length)}%)`,
      negativeCorrect: `${unanswerable.filter((item) => item.passed).length}/${unanswerable.length} (${pct(unanswerable.filter((item) => item.passed).length, unanswerable.length)}%)`
    },
    runtime: {
      delayMs,
      hybridCount: results.filter((item) => item.retrievalMode === "hybrid").length,
      vectorUsedCount: results.filter((item) => item.vectorUsed).length
    },
    failures: results.filter((item) => !item.passed),
    cases: results
  };

  if (args.output) {
    await fs.writeFile(path.resolve(args.output), JSON.stringify(report, null, 2), "utf8");
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("[error] manual evaluation failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeVectorPool();
  });
