#!/usr/bin/env node
import "dotenv/config";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const repoRoot = path.dirname(projectDir);

const DEFAULT_SOURCE_DIR = path.join(repoRoot, "manuals", "user");
const LEGACY_SOURCE_DIR = path.join(repoRoot, "stor", "stor", "manual", "user");
const DEFAULT_PDF_DIR = path.join(repoRoot, "manuals", "pdf");
const DEFAULT_PREVIEW_DIR = path.join(repoRoot, "manuals", "preview");
const DEFAULT_TMP_DIR = path.join(projectDir, "tmp", "manual-preview");
const DEFAULT_REPORT_PATH = path.join(projectDir, "docs", "eval", "manual_preview_coverage.latest.json");
const DEFAULT_MIN_SCORE = 0.12;
const DEFAULT_LIMIT = 0;
const DEFAULT_DPI = 120;

function parseIntSafe(raw, fallback) {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFloatSafe(raw, fallback) {
  const parsed = Number.parseFloat(raw ?? "");
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseBool(raw, fallback = false) {
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultSourceDir() {
  if (process.env.MANUAL_SOURCE_DIR?.trim()) {
    return path.resolve(process.env.MANUAL_SOURCE_DIR.trim());
  }
  if (await pathExists(DEFAULT_SOURCE_DIR)) {
    return DEFAULT_SOURCE_DIR;
  }
  return LEGACY_SOURCE_DIR;
}

async function parseArgs(argv) {
  const args = {
    sourceDir: await resolveDefaultSourceDir(),
    pdfDir: process.env.MANUAL_PDF_DIR?.trim() || DEFAULT_PDF_DIR,
    previewDir: process.env.MANUAL_PREVIEW_DIR?.trim() || DEFAULT_PREVIEW_DIR,
    tmpDir: process.env.MANUAL_PREVIEW_TMP_DIR?.trim() || DEFAULT_TMP_DIR,
    reportPath: process.env.MANUAL_PREVIEW_REPORT_PATH?.trim() || DEFAULT_REPORT_PATH,
    minScore: parseFloatSafe(process.env.MANUAL_PREVIEW_MIN_SCORE, DEFAULT_MIN_SCORE),
    limit: parseIntSafe(process.env.MANUAL_PREVIEW_LIMIT, DEFAULT_LIMIT),
    dpi: parseIntSafe(process.env.MANUAL_PREVIEW_DPI, DEFAULT_DPI),
    documentId: "",
    dryRun: false,
    coverageOnly: false,
    force: false,
    skipExisting: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--source-dir" && argv[index + 1]) {
      args.sourceDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--pdf-dir" && argv[index + 1]) {
      args.pdfDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--preview-dir" && argv[index + 1]) {
      args.previewDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--tmp-dir" && argv[index + 1]) {
      args.tmpDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--report-path" && argv[index + 1]) {
      args.reportPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--min-score" && argv[index + 1]) {
      args.minScore = parseFloatSafe(argv[index + 1], args.minScore);
      index += 1;
      continue;
    }
    if (current === "--limit" && argv[index + 1]) {
      args.limit = parseIntSafe(argv[index + 1], args.limit);
      index += 1;
      continue;
    }
    if (current === "--dpi" && argv[index + 1]) {
      args.dpi = parseIntSafe(argv[index + 1], args.dpi);
      index += 1;
      continue;
    }
    if (current === "--document-id" && argv[index + 1]) {
      args.documentId = argv[index + 1].trim();
      index += 1;
      continue;
    }
    if (current === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (current === "--coverage-only") {
      args.coverageOnly = true;
      continue;
    }
    if (current === "--force") {
      args.force = true;
      args.skipExisting = false;
      continue;
    }
    if (current === "--no-skip-existing") {
      args.skipExisting = false;
    }
  }

  return {
    ...args,
    sourceDir: path.resolve(args.sourceDir),
    pdfDir: path.resolve(args.pdfDir),
    previewDir: path.resolve(args.previewDir),
    tmpDir: path.resolve(args.tmpDir),
    reportPath: path.resolve(args.reportPath),
    minScore: Math.max(0, Math.min(1, args.minScore)),
    dpi: Math.max(72, args.dpi)
  };
}

function getPool() {
  return new Pool({
    host: process.env.VECTOR_DB_HOST ?? "DB_HOST_REMOVED",
    port: parseIntSafe(process.env.VECTOR_DB_PORT, 5432),
    database: process.env.VECTOR_DB_NAME ?? "ai2",
    user: process.env.VECTOR_DB_USER ?? "novian",
    password: process.env.VECTOR_DB_PASSWORD ?? "REMOVED",
    ssl: process.env.VECTOR_DB_SSL === "true"
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...(options.env ?? {}) }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} exited with ${code}: ${stderr || stdout}`.trim());
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function commandExists(command) {
  const checker = process.platform === "win32" ? "where.exe" : "which";
  try {
    await runCommand(checker, [command]);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommand(candidates) {
  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function toHash(input) {
  return createHash("sha1").update(input, "utf8").digest("hex").slice(0, 12);
}

function normalizePathKey(value) {
  return value.replace(/\\/g, "/");
}

function toPdfRelPath(sourceRelPath) {
  return normalizePathKey(sourceRelPath).replace(/\.[^.]+$/u, ".pdf");
}

function sanitizeForTempName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 96);
}

function normalizeForMatch(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCharGramSet(text, maxChars = 2800) {
  const compact = normalizeForMatch(text).replace(/\s+/g, "").slice(0, maxChars);
  const grams = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(compact.slice(index, index + 2));
  }
  return grams;
}

function buildTokenSet(text, maxTokens = 260) {
  const tokens = normalizeForMatch(text)
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, maxTokens);
  return new Set(tokens);
}

function overlapCount(left, right) {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) count += 1;
  }
  return count;
}

function scoreTextMatch(chunkText, pageText) {
  const chunkGrams = buildCharGramSet(chunkText);
  const pageGrams = buildCharGramSet(pageText, 12000);
  const chunkTokens = buildTokenSet(chunkText);
  const pageTokens = buildTokenSet(pageText, 1200);

  if (chunkGrams.size === 0 && chunkTokens.size === 0) {
    return 0;
  }

  const gramOverlap = overlapCount(chunkGrams, pageGrams);
  const gramRecall = chunkGrams.size > 0 ? gramOverlap / chunkGrams.size : 0;
  const gramPrecision = pageGrams.size > 0 ? gramOverlap / Math.min(pageGrams.size, Math.max(chunkGrams.size, 1) * 4) : 0;
  const tokenRecall = chunkTokens.size > 0 ? overlapCount(chunkTokens, pageTokens) / chunkTokens.size : 0;
  return Math.max(0, Math.min(1, 0.55 * gramRecall + 0.2 * gramPrecision + 0.25 * tokenRecall));
}

function bestPageMatch(chunkText, pages) {
  let best = { pageIndex: -1, score: 0 };
  for (let index = 0; index < pages.length; index += 1) {
    const score = scoreTextMatch(chunkText, pages[index].text);
    if (score > best.score) {
      best = { pageIndex: index, score };
    }
  }
  return best;
}

async function fetchManualDocuments(pool, args) {
  const params = [];
  const conditions = ["d.audience = 'user'"];
  if (args.documentId) {
    params.push(args.documentId);
    conditions.push(`d.document_id = $${params.length}::uuid`);
  }
  if (args.limit > 0) {
    params.push(args.limit);
  }
  const limitClause = args.limit > 0 ? `limit $${params.length}` : "";

  const result = await pool.query(
    `
    select
      d.document_id::text as document_id,
      d.product,
      d.title,
      d.version,
      d.source_path,
      d.source_rel_path,
      d.file_mtime,
      count(c.chunk_id)::int as chunk_count
    from ai_core.manual_documents d
    join ai_core.manual_chunks c
      on c.document_id = d.document_id
    where ${conditions.join(" and ")}
    group by d.document_id, d.product, d.title, d.version, d.source_path, d.source_rel_path, d.file_mtime
    order by d.product, d.title
    ${limitClause}
    `,
    params
  );
  return result.rows;
}

async function fetchManualChunks(pool, documentId) {
  const result = await pool.query(
    `
    select
      chunk_id::text as chunk_id,
      document_id::text as document_id,
      chunk_seq,
      section_title,
      chunk_text
    from ai_core.manual_chunks
    where document_id = $1::uuid
      and audience = 'user'
    order by chunk_seq
    `,
    [documentId]
  );
  return result.rows;
}

async function listExistingPreviewCoverage(pool, previewDir, args) {
  const documents = await fetchManualDocuments(pool, args);
  let totalChunks = 0;
  let existing = 0;
  const perDocument = [];

  for (const document of documents) {
    const chunks = await fetchManualChunks(pool, document.document_id);
    let documentExisting = 0;
    for (const chunk of chunks) {
      totalChunks += 1;
      if (await pathExists(path.join(previewDir, document.document_id, `${chunk.chunk_id}.png`))) {
        existing += 1;
        documentExisting += 1;
      }
    }
    perDocument.push({
      documentId: document.document_id,
      title: document.title,
      chunks: chunks.length,
      previewImages: documentExisting,
      coveragePct: chunks.length > 0 ? Number(((documentExisting / chunks.length) * 100).toFixed(2)) : 0
    });
  }

  return {
    documents: documents.length,
    totalChunks,
    previewImages: existing,
    coveragePct: totalChunks > 0 ? Number(((existing / totalChunks) * 100).toFixed(2)) : 0,
    perDocument
  };
}

async function resolveSourcePath(document, sourceDir) {
  const stored = path.resolve(document.source_path);
  if (await pathExists(stored)) {
    return stored;
  }
  const fromRel = path.resolve(sourceDir, document.source_rel_path);
  if (await pathExists(fromRel)) {
    return fromRel;
  }
  return null;
}

async function ensurePdf(document, sourcePath, args, tools) {
  const relPdf = toPdfRelPath(document.source_rel_path);
  const pdfPath = path.join(args.pdfDir, relPdf);
  if (await pathExists(pdfPath)) {
    return { pdfPath, created: false, source: "existing_pdf" };
  }
  if (!tools.office) {
    throw new Error("LibreOffice/soffice command not found. Provide preconverted PDFs or install libreoffice.");
  }

  const outputDir = path.dirname(pdfPath);
  await fs.mkdir(outputDir, { recursive: true });
  await runCommand(tools.office, ["--headless", "--convert-to", "pdf", "--outdir", outputDir, sourcePath]);

  const generatedPath = path.join(outputDir, `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`);
  if (generatedPath !== pdfPath && (await pathExists(generatedPath))) {
    await fs.rename(generatedPath, pdfPath);
  }
  if (!(await pathExists(pdfPath))) {
    throw new Error(`PDF conversion finished but output was not found: ${pdfPath}`);
  }
  return { pdfPath, created: true, source: "converted_docx" };
}

async function extractPdfPages(pdfPath, workDir, tools, dpi) {
  if (!tools.pdftotext || !tools.pdftoppm) {
    throw new Error("pdftotext/pdftoppm command not found. Install poppler-utils.");
  }
  await fs.mkdir(workDir, { recursive: true });

  const textPath = path.join(workDir, "pages.txt");
  await runCommand(tools.pdftotext, ["-layout", pdfPath, textPath]);
  const text = await fs.readFile(textPath, "utf8");
  const pageTexts = text.split("\f").map((page) => page.trim());

  const imagePrefix = path.join(workDir, "page");
  await runCommand(tools.pdftoppm, ["-png", "-r", String(dpi), pdfPath, imagePrefix]);
  const files = await fs.readdir(workDir);
  const imageFiles = files
    .filter((file) => /^page-\d+\.png$/i.test(file))
    .sort((left, right) => {
      const leftNum = Number(left.match(/\d+/)?.[0] ?? 0);
      const rightNum = Number(right.match(/\d+/)?.[0] ?? 0);
      return leftNum - rightNum;
    })
    .map((file) => path.join(workDir, file));

  return imageFiles.map((imagePath, index) => ({
    pageNumber: index + 1,
    imagePath,
    text: pageTexts[index] ?? ""
  }));
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function emptyTotals() {
  return {
    documents: 0,
    processedDocuments: 0,
    failedDocuments: 0,
    totalChunks: 0,
    generated: 0,
    skippedExisting: 0,
    lowConfidence: 0,
    unmatched: 0
  };
}

async function generatePreviews(pool, args, tools) {
  const documents = await fetchManualDocuments(pool, args);
  const totals = emptyTotals();
  totals.documents = documents.length;
  const details = [];

  for (const document of documents) {
    const detail = {
      documentId: document.document_id,
      title: document.title,
      sourceRelPath: document.source_rel_path,
      chunks: 0,
      generated: 0,
      skippedExisting: 0,
      lowConfidence: 0,
      unmatched: 0,
      pageCount: 0,
      status: "ok",
      error: null,
      pdfSource: null
    };

    try {
      const sourcePath = await resolveSourcePath(document, args.sourceDir);
      if (!sourcePath) {
        throw new Error(`manual source not found: ${document.source_path} or ${path.join(args.sourceDir, document.source_rel_path)}`);
      }

      const chunks = await fetchManualChunks(pool, document.document_id);
      detail.chunks = chunks.length;
      totals.totalChunks += chunks.length;

      const { pdfPath, source } = await ensurePdf(document, sourcePath, args, tools);
      detail.pdfSource = source;

      const workDir = path.join(args.tmpDir, `${sanitizeForTempName(document.title)}-${toHash(document.document_id)}`);
      await fs.rm(workDir, { recursive: true, force: true });
      const pages = await extractPdfPages(pdfPath, workDir, tools, args.dpi);
      detail.pageCount = pages.length;

      for (const chunk of chunks) {
        const targetPath = path.join(args.previewDir, document.document_id, `${chunk.chunk_id}.png`);
        if (args.skipExisting && !args.force && (await pathExists(targetPath))) {
          detail.skippedExisting += 1;
          totals.skippedExisting += 1;
          continue;
        }

        const match = bestPageMatch(`${chunk.section_title ?? ""}\n${chunk.chunk_text}`, pages);
        if (match.pageIndex < 0) {
          detail.unmatched += 1;
          totals.unmatched += 1;
          continue;
        }
        if (match.score < args.minScore) {
          detail.lowConfidence += 1;
          totals.lowConfidence += 1;
          continue;
        }

        if (!args.dryRun) {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.copyFile(pages[match.pageIndex].imagePath, targetPath);
        }
        detail.generated += 1;
        totals.generated += 1;
      }

      totals.processedDocuments += 1;
      console.log(
        `[doc] ${document.title} chunks=${detail.chunks} pages=${detail.pageCount} generated=${detail.generated} skipped=${detail.skippedExisting} lowConfidence=${detail.lowConfidence}`
      );
    } catch (error) {
      detail.status = "error";
      detail.error = error instanceof Error ? error.message : String(error);
      totals.failedDocuments += 1;
      console.warn(`[warn] ${document.title}: ${detail.error}`);
    }
    details.push(detail);
  }

  const coverage = await listExistingPreviewCoverage(pool, args.previewDir, args);
  return { totals, coverage, details };
}

async function main() {
  const args = await parseArgs(process.argv.slice(2));
  console.log(`[info] source_dir=${args.sourceDir}`);
  console.log(`[info] pdf_dir=${args.pdfDir}`);
  console.log(`[info] preview_dir=${args.previewDir}`);
  console.log(`[info] report_path=${args.reportPath}`);

  const pool = getPool();
  try {
    if (args.coverageOnly) {
      const coverage = await listExistingPreviewCoverage(pool, args.previewDir, args);
      const report = { generatedAt: new Date().toISOString(), mode: "coverage_only", args, coverage };
      await writeJson(args.reportPath, report);
      console.log(`[coverage] chunks=${coverage.totalChunks}, previewImages=${coverage.previewImages}, coveragePct=${coverage.coveragePct}`);
      console.log(`[report] ${args.reportPath}`);
      return;
    }

    const tools = {
      office: await resolveCommand(["soffice", "libreoffice"]),
      pdftotext: await resolveCommand(["pdftotext"]),
      pdftoppm: await resolveCommand(["pdftoppm"])
    };
    console.log(`[tools] office=${tools.office ?? "missing"}, pdftotext=${tools.pdftotext ?? "missing"}, pdftoppm=${tools.pdftoppm ?? "missing"}`);

    const result = await generatePreviews(pool, args, tools);
    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.dryRun ? "dry_run" : "generate",
      args,
      tools,
      ...result
    };
    await writeJson(args.reportPath, report);
    console.log(
      `[ok] documents=${result.totals.processedDocuments}/${result.totals.documents}, chunks=${result.totals.totalChunks}, generated=${result.totals.generated}, skippedExisting=${result.totals.skippedExisting}, lowConfidence=${result.totals.lowConfidence}, coveragePct=${result.coverage.coveragePct}`
    );
    console.log(`[report] ${args.reportPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[error] manual preview generation failed");
  console.error(error);
  process.exitCode = 1;
});
