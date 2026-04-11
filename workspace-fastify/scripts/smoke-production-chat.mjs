import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_DATASET = "docs/eval/production_smoke.seed.json";
const DEFAULT_BASE_URL = "https://csbotservice.com/api";
const DEFAULT_OUTPUT = "docs/eval/production_smoke.latest.json";

function parseArgs(argv) {
  const args = {
    dataset: DEFAULT_DATASET,
    baseUrl: process.env.SMOKE_BASE_URL ?? DEFAULT_BASE_URL,
    output: DEFAULT_OUTPUT,
    limit: null,
    delayMs: Number.parseInt(process.env.SMOKE_QUERY_DELAY_MS ?? "700", 10),
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
    if (value === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--limit" && argv[index + 1]) {
      const parsed = Number.parseInt(argv[index + 1], 10);
      args.limit = Number.isFinite(parsed) ? parsed : null;
      index += 1;
      continue;
    }
    if (value === "--delay-ms" && argv[index + 1]) {
      const parsed = Number.parseInt(argv[index + 1], 10);
      args.delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : args.delayMs;
      index += 1;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

async function loadDataset(datasetPath) {
  const raw = (await fs.readFile(path.resolve(datasetPath), "utf8")).replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("smoke dataset must be a JSON array");
  }
  return parsed;
}

function parseSsePayload(text) {
  const events = [];
  for (const block of text.split(/\n\n+/)) {
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        events.push({ type: "parse_error", raw: payload.slice(0, 300) });
      }
    }
  }
  return events;
}

function summarizeEvents(events) {
  let metadata = null;
  let done = null;
  let answerText = "";
  const parseErrors = [];

  for (const event of events) {
    if (event.type === "metadata") {
      metadata = event.data ?? null;
      continue;
    }
    if (event.type === "chunk") {
      answerText += typeof event.data === "string" ? event.data : "";
      continue;
    }
    if (event.type === "done") {
      done = event.data ?? {};
      continue;
    }
    if (event.type === "parse_error") {
      parseErrors.push(event.raw);
    }
  }

  return { metadata, done, answerText, parseErrors };
}

function evaluateItem(item, response) {
  const failures = [];
  const expectAnswer = item.expectAnswer !== false;
  const minAnswerLength = Number.isFinite(item.minAnswerLength) ? item.minAnswerLength : 20;

  if (!response.ok) {
    failures.push(`HTTP_${response.status}`);
  }

  if (response.jsonError) {
    failures.push(`JSON_ERROR_${response.jsonError}`);
  }

  if (expectAnswer) {
    if (response.error) {
      failures.push(`ERROR_${response.error}`);
    }
    if ((response.answerText ?? "").trim().length < minAnswerLength) {
      failures.push("ANSWER_TOO_SHORT");
    }
    if (item.requireLink && !response.linkUrl) {
      failures.push("MISSING_LINK");
    }
    if (response.metadata && response.metadata.bestRequireId === null) {
      failures.push("MISSING_BEST_REQUIRE_ID");
    }
  }

  if (response.parseErrors?.length) {
    failures.push("SSE_PARSE_ERROR");
  }

  return failures;
}

async function requestChatStream(baseUrl, item) {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/stream`;
  const startedAt = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      query: item.query,
      retrievalScope: item.retrievalScope ?? "all",
    }),
  });

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const elapsedMs = Date.now() - startedAt;

  if (contentType.includes("application/json")) {
    const json = JSON.parse(text);
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs,
      contentType,
      jsonError: json.error ?? null,
      error: json.error ?? null,
      message: json.message ?? null,
      answerText: json.generatedAnswer ?? json.display?.answerText ?? json.message ?? "",
      linkUrl: json.similarIssueUrl ?? json.display?.linkUrl ?? null,
      metadata: json,
      done: null,
      parseErrors: [],
      rawPreview: text.slice(0, 500),
    };
  }

  const events = parseSsePayload(text);
  const summary = summarizeEvents(events);
  return {
    ok: res.ok,
    status: res.status,
    elapsedMs,
    contentType,
    jsonError: null,
    error: null,
    message: null,
    answerText: summary.answerText,
    linkUrl: summary.metadata?.similarIssueUrl ?? summary.metadata?.display?.linkUrl ?? null,
    metadata: summary.metadata,
    done: summary.done,
    parseErrors: summary.parseErrors,
    rawPreview: text.slice(0, 500),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataset = await loadDataset(args.dataset);
  const selected = dataset.slice(0, args.limit ?? dataset.length);
  const results = [];

  for (const item of selected) {
    try {
      const response = await requestChatStream(args.baseUrl, item);
      const failures = evaluateItem(item, response);
      results.push({
        id: item.id,
        query: item.query,
        tags: item.tags ?? [],
        passed: failures.length === 0,
        failures,
        status: response.status,
        elapsedMs: response.elapsedMs,
        answerLength: response.answerText.trim().length,
        linkUrl: response.linkUrl,
        bestRequireId: response.metadata?.bestRequireId ?? response.metadata?.display?.bestRequireId ?? null,
        confidence: response.metadata?.confidence ?? response.metadata?.display?.confidence ?? null,
        retrievalMode: response.metadata?.retrievalMode ?? response.metadata?.display?.retrievalMode ?? null,
        answerSource: response.metadata?.answerSource ?? response.metadata?.display?.answerSource ?? null,
        error: response.error,
        message: response.message,
      });
    } catch (error) {
      results.push({
        id: item.id,
        query: item.query,
        tags: item.tags ?? [],
        passed: false,
        failures: ["REQUEST_FAILED"],
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  const passed = results.filter((item) => item.passed).length;
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    dataset: path.resolve(args.dataset),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };

  await fs.writeFile(path.resolve(args.output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (report.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[error] production smoke failed");
  console.error(error);
  process.exitCode = 1;
});
