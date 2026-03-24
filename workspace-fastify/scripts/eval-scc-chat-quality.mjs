import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_DATASET = "docs/eval/scc_eval_set.seed.json";
const DEFAULT_BASE_URL = "http://localhost:3101";

function parseArgs(argv) {
  const args = {
    dataset: DEFAULT_DATASET,
    baseUrl: process.env.CHAT_EVAL_BASE_URL ?? DEFAULT_BASE_URL,
    limit: null,
    output: "docs/eval/chat_quality.phase3.latest.json"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dataset" && argv[index + 1]) {
      args.dataset = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--base-url" && argv[index + 1]) {
      args.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--limit" && argv[index + 1]) {
      const parsed = Number.parseInt(argv[index + 1], 10);
      args.limit = Number.isFinite(parsed) ? parsed : null;
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

function parseDelayMs() {
  const raw = process.env.CHAT_EVAL_DELAY_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 1500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function loadDataset(datasetPath) {
  const absolutePath = path.resolve(datasetPath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("dataset must be a JSON array");
  }
  return parsed;
}

function hasUsableAnswer(text) {
  return typeof text === "string" && text.trim().length >= 20;
}

function isNegativeGuarded(response) {
  if (response.bestRequireId !== null) {
    return false;
  }

  if (!hasUsableAnswer(response.generatedAnswer)) {
    return false;
  }

  if (response.similarIssueUrl) {
    return false;
  }

  return /정확히 일치|추가 증상|추가 정보|재탐색|확인 요청|핵심 안내/u.test(response.generatedAnswer);
}

function toFailure(item, response, reason) {
  return {
    id: item.id,
    query: item.query,
    reason,
    expectedRequireId: item.expectedRequireId ?? null,
    acceptedRequireIds: item.acceptedRequireIds ?? [],
    actualBestRequireId: response.bestRequireId ?? null,
    answerSource: response.answerSource ?? null,
    similarIssueUrl: response.similarIssueUrl ?? null,
    generatedAnswer: typeof response.generatedAnswer === "string"
      ? response.generatedAnswer.slice(0, 280)
      : null,
    llmUsed: response.llmUsed ?? false,
    llmSkipped: response.llmSkipped ?? false,
    timings: response.timings ?? null
  };
}

function getAcceptedRequireIds(item) {
  return [
    item.expectedRequireId ?? null,
    ...((Array.isArray(item.acceptedRequireIds) ? item.acceptedRequireIds : []).filter(Boolean))
  ].filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const delayMs = parseDelayMs();
  const dataset = await loadDataset(args.dataset);
  const selected = dataset.slice(0, args.limit ?? dataset.length);

  const summary = {
    total: selected.length,
    answerable: 0,
    unanswerable: 0,
    exactBestHits: 0,
    top3SupportHits: 0,
    answerFormatOk: 0,
    linkAttached: 0,
    negativeGuarded: 0,
    answerSourceMissing: 0,
    failures: []
  };

  for (const item of selected) {
    const response = await fetch(`${args.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        query: item.query,
        retrievalScope: item.retrievalScope ?? "scc"
      })
    }).then((res) => res.json());

    const hasAnswer = hasUsableAnswer(response.generatedAnswer);
    const acceptedRequireIds = getAcceptedRequireIds(item);
    const top3Support = acceptedRequireIds.length > 0
      ? Array.isArray(response.candidates) &&
        response.candidates.slice(0, 3).some((candidate) => acceptedRequireIds.includes(candidate.requireId))
      : false;

    if (item.answerable) {
      summary.answerable += 1;
      if (acceptedRequireIds.includes(response.bestRequireId ?? null)) {
        summary.exactBestHits += 1;
      }
      if (top3Support) {
        summary.top3SupportHits += 1;
      }
      if (hasAnswer) {
        summary.answerFormatOk += 1;
      } else {
        summary.failures.push(toFailure(item, response, "MISSING_GENERATED_ANSWER"));
      }
      if (response.similarIssueUrl) {
        summary.linkAttached += 1;
      } else {
        summary.failures.push(toFailure(item, response, "MISSING_SIMILAR_LINK"));
      }
      if (!response.answerSource) {
        summary.answerSourceMissing += 1;
      }
    } else {
      summary.unanswerable += 1;
      if (isNegativeGuarded(response)) {
        summary.negativeGuarded += 1;
      } else {
        summary.failures.push(toFailure(item, response, "NEGATIVE_GUARD_FAILED"));
      }
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: path.resolve(args.dataset),
    baseUrl: args.baseUrl,
    summary: {
      total: summary.total,
      answerable: summary.answerable,
      unanswerable: summary.unanswerable,
      exactBestHit: `${summary.exactBestHits}/${summary.answerable} (${pct(summary.exactBestHits, summary.answerable)}%)`,
      top3SupportHit: `${summary.top3SupportHits}/${summary.answerable} (${pct(summary.top3SupportHits, summary.answerable)}%)`,
      policyMode: "expectedRequireId_or_acceptedRequireIds",
      answerFormatOk: `${summary.answerFormatOk}/${summary.answerable} (${pct(summary.answerFormatOk, summary.answerable)}%)`,
      linkAttached: `${summary.linkAttached}/${summary.answerable} (${pct(summary.linkAttached, summary.answerable)}%)`,
      negativeGuarded: `${summary.negativeGuarded}/${summary.unanswerable} (${pct(summary.negativeGuarded, summary.unanswerable)}%)`,
      answerSourceMissing: summary.answerSourceMissing,
      delayMs
    },
    failures: summary.failures.slice(0, 30)
  };

  await fs.writeFile(
    path.resolve(args.output),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("[error] chat quality evaluation failed");
  console.error(error);
  process.exitCode = 1;
});
