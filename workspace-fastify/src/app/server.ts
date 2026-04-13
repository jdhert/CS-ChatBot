import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyCors from "@fastify/cors";
import { createReadStream } from "node:fs";
import { stat as statFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import type { PoolClient } from "pg";
import { renderChatTestPage } from "../modules/chat/chatTestPage.js";
import {
  runChatSearch,
  runChatSearchDebug,
  getQueryEmbeddingRuntimeStatus,
  startCacheCleanupInterval,
  stopCacheCleanupInterval,
} from "../modules/chat/chat.service.js";
import {
  generateChatAnswer,
  generateChatAnswerStream,
  rewriteQueryForRetrieval,
  startLlmCacheCleanupInterval,
  stopLlmCacheCleanupInterval,
} from "../modules/chat/llm.service.js";
import type {
  ChatRequestBody,
  ChatResponseBody,
  ConversationTurn,
  ManualCandidate,
  RetrievalDebugRequestBody,
  RetrievalScope
} from "../modules/chat/chat.types.js";
import { closeVectorPool, getVectorPool } from "../platform/db/vectorClient.js";
import {
  getCachedResult,
  setCachedResult,
  evictExpiredEntries,
  getCacheStats,
} from "../platform/cache/queryCache.js";
import { startIngestScheduler, type IngestSchedulerHandle } from "../platform/scheduler/ingestScheduler.js";

const COVISION_SERVICE_VIEW_BASE_URL =
  "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx";

// 질의 로그 적재용 스키마
interface QueryLogEntry {
  logUuid: string;
  query: string;
  retrievalScope?: string;
  confidence?: number;
  bestRequireId?: string | null;
  bestSccId?: string | null;
  chunkType?: string | null;
  vectorUsed?: boolean;
  retrievalMode?: string;
  answerSource?: string | null;
  llmUsed?: boolean;
  llmSkipped?: boolean;
  llmSkipReason?: string | null;
  isNoMatch: boolean;
  isFailure?: boolean;
  failureReason?: string | null;
  ruleMs?: number;
  embeddingMs?: number;
  vectorMs?: number;
  rerankMs?: number;
  retrievalMs?: number;
  llmMs?: number;
  totalMs?: number;
}

interface StreamTimingMetadata {
  rewriteMs?: number | null;
  retrievalMs?: number | null;
  ruleMs?: number | null;
  embeddingMs?: number | null;
  vectorMs?: number | null;
  rerankMs?: number | null;
  llmFirstTokenMs?: number | null;
  llmStreamMs?: number | null;
  cacheReplayMs?: number | null;
  persistenceMs?: number | null;
  totalMs?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 대화 세션 / 메시지 저장용 구조

interface ConversationSessionInput {
  clientSessionId?: string | null;
  userKey?: string | null;
  title?: string | null;
}

interface ConversationMessageInput {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status?: string | null;
  answerSource?: string | null;
  retrievalMode?: string | null;
  confidence?: number | null;
  bestRequireId?: string | null;
  bestSccId?: string | null;
  similarIssueUrl?: string | null;
  logUuid?: string | null;
  metadata?: Record<string, unknown>;
}

interface ConversationPersistenceContext {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
}

type EmbeddingCoverageAlertLevel = "ok" | "warning" | "critical";

interface EmbeddingCoverageAlert {
  level: EmbeddingCoverageAlertLevel;
  message: string;
  reasons: string[];
  warnMinCoveragePct: number;
  criticalMinCoveragePct: number;
  warnPendingChunks: number;
  criticalPendingChunks: number;
}

interface EmbeddingCoverageSnapshot {
  available: boolean;
  sourceChunkRows: number;
  minCoveragePct: number | null;
  pendingChunks: number;
  coverage: Array<{
    embedding_model: string;
    source_chunk_rows: number;
    embedded_chunks: number;
    coverage_pct: number | null;
  }>;
  status: unknown[];
  ingestState: Array<{
    state_key?: string;
    last_source_ingested_at?: Date | string | null;
    last_run_at?: Date | string | null;
    last_status?: string | null;
    last_message?: string | null;
    updated_at?: Date | string | null;
  }>;
  alert: EmbeddingCoverageAlert;
  error: string | null;
}

let embeddingCoverageCache: {
  expiresAt: number;
  snapshot: EmbeddingCoverageSnapshot;
} | null = null;
let embeddingCoverageHealthProbeInFlight: Promise<EmbeddingCoverageSnapshot> | null = null;

function getBuildInfo() {
  const commitSha = process.env.APP_COMMIT_SHA?.trim() || process.env.GITHUB_SHA?.trim() || "unknown";
  const buildTime = process.env.APP_BUILD_TIME?.trim() || null;
  const refName = process.env.APP_BUILD_REF?.trim() || process.env.GITHUB_REF_NAME?.trim() || null;
  const runId = process.env.APP_GITHUB_RUN_ID?.trim() || null;
  const repository = process.env.APP_GITHUB_REPOSITORY?.trim() || null;
  const imageTag = process.env.APP_IMAGE_TAG?.trim() || "latest";

  return {
    commitSha,
    buildTime,
    refName,
    runId,
    repository,
    imageTag,
  };
}

function buildConversationTitle(query: string): string {
  const normalized = query
    .replace(/\s+/g, " ")
    .replace(/^(안녕하세요|안녕|혹시|저기|음|어|그|저)\s*[,.:!?]?\s*/i, "")
    .trim();
  const titleSource = normalized || query.trim() || "새 대화";
  return titleSource.length > 40 ? `${titleSource.slice(0, 40)}...` : titleSource;
}

async function ensureConversationSession(input: ConversationSessionInput): Promise<string> {
  const pool = getVectorPool();
  const clientSessionId = input.clientSessionId?.trim() || null;
  const userKey = input.userKey?.trim() || null;
  const title = input.title?.trim() || null;

  if (clientSessionId) {
    const existing = await pool.query<{ session_id: string }>(
      `select session_id
         from ai_core.conversation_session
        where client_session_id = $1
        limit 1`,
      [clientSessionId]
    );

    if (existing.rowCount && existing.rows[0]?.session_id) {
      const sessionId = existing.rows[0].session_id;
      await pool.query(
        `update ai_core.conversation_session
            set user_key = coalesce(user_key, $2),
                title = coalesce(title, $3),
                updated_at = now()
          where session_id = $1`,
        [sessionId, userKey, title]
      );
      return sessionId;
    }
  }

  const sessionId = crypto.randomUUID();
  await pool.query(
    `insert into ai_core.conversation_session
      (session_id, client_session_id, user_key, title, last_message_at)
     values ($1, $2, $3, $4, now())`,
    [sessionId, clientSessionId, userKey, title]
  );
  return sessionId;
}

async function appendConversationMessage(input: ConversationMessageInput): Promise<string> {
  const pool = getVectorPool();
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `select session_id
         from ai_core.conversation_session
        where session_id = $1
        for update`,
      [input.sessionId]
    );

    await client.query(
      `with next_turn as (
         select coalesce(max(turn_index), 0) + 1 as turn_index
           from ai_core.conversation_message
          where session_id = $2
       )
       insert into ai_core.conversation_message
         (message_id, session_id, turn_index, role, content, status, answer_source, retrieval_mode,
          confidence, best_require_id, best_scc_id, similar_issue_url, log_uuid, metadata)
       select
         $1, $2, next_turn.turn_index, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13::jsonb
       from next_turn
       on conflict (message_id) do nothing`,
      [
        input.messageId,
        input.sessionId,
        input.role,
        input.content,
        input.status ?? null,
        input.answerSource ?? null,
        input.retrievalMode ?? null,
        input.confidence ?? null,
        input.bestRequireId ?? null,
        input.bestSccId ? BigInt(input.bestSccId) : null,
        input.similarIssueUrl ?? null,
        input.logUuid ?? null,
        metadataJson
      ]
    );

    await client.query(
      `update ai_core.conversation_session
          set message_count = (
                select count(*)::int
                  from ai_core.conversation_message
                 where session_id = $1
              ),
              last_message_at = now(),
              updated_at = now()
        where session_id = $1`,
      [input.sessionId]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return input.messageId;
}

async function startConversationPersistence(input: {
  clientSessionId?: string | null;
  userKey?: string | null;
  title: string;
  query: string;
  retrievalScope: RetrievalScope;
}): Promise<ConversationPersistenceContext> {
  const conversationId = await ensureConversationSession({
    clientSessionId: input.clientSessionId,
    userKey: input.userKey,
    title: input.title,
  });

  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();

  await appendConversationMessage({
    messageId: userMessageId,
    sessionId: conversationId,
    role: "user",
    content: input.query,
    status: "submitted",
    metadata: {
      retrievalScope: input.retrievalScope,
      clientConversationId: input.clientSessionId ?? null,
    },
  });

  return {
    conversationId,
    userMessageId,
    assistantMessageId,
  };
}

async function finishConversationPersistence(input: {
  context: ConversationPersistenceContext;
  content: string;
  status: string | null;
  answerSource?: string | null;
  retrievalMode?: string | null;
  confidence?: number | null;
  bestRequireId?: string | null;
  bestSccId?: string | null;
  similarIssueUrl?: string | null;
  logUuid?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  await appendConversationMessage({
    messageId: input.context.assistantMessageId,
    sessionId: input.context.conversationId,
    role: "assistant",
    content: input.content,
    status: input.status,
    answerSource: input.answerSource ?? null,
    retrievalMode: input.retrievalMode ?? null,
    confidence: input.confidence ?? null,
    bestRequireId: input.bestRequireId ?? null,
    bestSccId: input.bestSccId ?? null,
    similarIssueUrl: input.similarIssueUrl ?? null,
    logUuid: input.logUuid ?? null,
    metadata: input.metadata ?? {},
  });

  return input.context.assistantMessageId;
}

// 쿼리 로그는 응답 지연을 줄이기 위해 fire-and-forget으로 적재
function logQuery(entry: QueryLogEntry): void {
  const pool = getVectorPool();
  const isFailure = entry.isFailure ?? (entry.isNoMatch || (entry.confidence !== undefined && entry.confidence < 0.35));
  const failureReason = entry.failureReason ?? (
    entry.isNoMatch ? "NO_MATCH" :
    (entry.confidence !== undefined && entry.confidence < 0.35) ? "LOW_CONFIDENCE" :
    null
  );
  pool.query(
    `insert into ai_core.query_log
      (log_uuid, query, retrieval_scope, confidence, best_require_id, best_scc_id,
       chunk_type, vector_used, retrieval_mode, answer_source,
       llm_used, llm_skipped, llm_skip_reason, is_no_match, is_failure, failure_reason,
       rule_ms, embedding_ms, vector_ms, rerank_ms, retrieval_ms, llm_ms, total_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [
      entry.logUuid,
      entry.query,
      entry.retrievalScope ?? null,
      entry.confidence ?? null,
      entry.bestRequireId ?? null,
      entry.bestSccId ? BigInt(entry.bestSccId) : null,
      entry.chunkType ?? null,
      entry.vectorUsed ?? null,
      entry.retrievalMode ?? null,
      entry.answerSource ?? null,
      entry.llmUsed ?? null,
      entry.llmSkipped ?? null,
      entry.llmSkipReason ?? null,
      entry.isNoMatch,
      isFailure,
      failureReason,
      entry.ruleMs ?? null,
      entry.embeddingMs ?? null,
      entry.vectorMs ?? null,
      entry.rerankMs ?? null,
      entry.retrievalMs ?? null,
      entry.llmMs ?? null,
      entry.totalMs ?? null,
    ]
  ).catch(() => { /* 로그 적재 실패는 무시 */ });
}
// 대화 이력 정제: 최근 4턴만 유지하고 role/content를 검증
function sanitizeHistory(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is ConversationTurn =>
      t !== null &&
      typeof t === "object" &&
      (t.role === "user" || t.role === "assistant") &&
      typeof t.content === "string" &&
      t.content.trim().length > 0
    )
    .slice(-4)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 500) }));
}
// 보안 차단 키워드 목록 - 악의적 의도가 명확한 표현만 차단
// "비밀번호 변경", "password 변경" 같은 정상 CS 문의는 허용
const BLOCKED_SECURITY_KEYWORDS = [
  // 보안 우회/차단 해제
  "보안차단", "보안우회", "보안해제", "보안 차단", "보안 우회", "보안 해제",

  // 권한 획득/탈취
  "권한획득", "권한 획득",
  "루트권한 획득", "root권한 획득", "관리자권한 획득", "admin권한 획득",
  "sudo 우회", "권한 탈취",

  // 비밀번호/계정 정보 요청
  "비밀번호 알려", "패스워드 알려", "암호 알려",
  "관리자 비밀번호 알려", "admin password 알려", "root password 알려",
  "db 비밀번호", "데이터베이스 비밀번호", "database password",
  "비밀번호탈취", "비밀번호 탈취", "패스워드해킹", "패스워드 해킹",
  "password crack", "password cracking", "password stealing", "password dump",

  // 공격 기법
  "해킹", "크랙", "익스플로잇",
  "SQL인젝션", "SQL injection", "sql inject",
  "XSS공격", "XSS 공격", "CSRF공격", "CSRF 공격",
  "백도어", "backdoor", "악성코드", "멀웨어", "malware", "랜섬웨어", "ransomware",
  "인증우회", "인증 우회", "authentication bypass",
  "세션하이재킹", "session hijacking", "session steal",

  // 계정/토큰 탈취
  "계정탈취", "계정 탈취", "account takeover", "account steal",
  "토큰탈취", "토큰 탈취", "token stealing", "token hijack",
  "credential theft", "credential stealing", "credential dump"
] as const;

/**
 * 질의에 보안 차단 키워드가 포함되어 있는지 검사
 */
function containsBlockedKeyword(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return BLOCKED_SECURITY_KEYWORDS.some(keyword =>
    lowerQuery.includes(keyword.toLowerCase())
  );
}

/**
 * DB 뷰의 regexp_replace(text, '\s+', ' ', 'g') 버그 때문에
 * 's' 문자가 공백으로 치환된 텍스트를 표시용으로 복구합니다.
 * 검색과 임베딩 파이프라인에는 적용하지 않습니다.
 */
function repairStrippedS(text: string): string {
  return text
    // SCC 화면/메뉴 축약어
    .replace(/\bBa e([Cc]onfig)\b/g, 'Base$1')
    .replace(/\bba e([Cc]onfig)\b/g, 'base$1')
    .replace(/\bPo t([Cc]enter)\b/g, 'Post$1')
    .replace(/\bSy tem(SMS)?\b/g, 'System$1')
    .replace(/\bsy tem\b/g, 'system')
    // SQL / 프로그램 키워드
    .replace(/\bIN ERT(\s+INTO)?\b/g, 'INSERT$1')
    .replace(/\bin ert\b/g, 'insert')
    .replace(/\bIN ERTED\b/g, 'INSERTED')
    .replace(/\bin erted\b/g, 'inserted')
    .replace(/\b elect\b/g, 'select')
    .replace(/\bSELECT\b/g, 'SELECT')
    // 공통 축약 복구
    .replace(/\b([Uu]) er([Cc]ode|[Dd]omain[Cc]ode|[Ii][Dd])?\b/g, (_, u, suffix) =>
      `${u === 'U' ? 'U' : 'u'}ser${suffix ?? ''}`)
    .replace(/\b([Ss]) torage\b/gi, 'Storage')
    .replace(/\b([Ss]) ervice(s?)\b/gi, 'Service$2')
    .replace(/\b([Ss]) e ion(s?)\b/gi, 'Session$2')
    .replace(/\b([Ss]) etting(s?)\b/gi, 'Setting$2');
}

const ANSWER_NOISE_PATTERNS: RegExp[] = [
  /\uC548\uB155\uD558\uC138\uC694[,.]?\s*/gim,
  /\uCF54\uBE44[\uC804\uC83C]\s*CS\s*\uB2F4\uB2F9\uC790\s*[^.\n]*\uC785\uB2C8\uB2E4\.?/gim,
  /\uB4F1\uB85D\uD558\uC2E0\s*SCC\uAC74\uC5D0\s*\uB300\uD574\s*/gim,
  /\uC544\uB798\uC640\s*\uAC19(?:\uC774|\uC740)\s*(?:\uB0B4\uC6A9\uC73C\uB85C\s*)?\uCC98\uB9AC\s*(?:\uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4|\uC9C4\uD589\s*\uC911\uC785\uB2C8\uB2E4)\.?/gim,
  /\uD655\uC778\s*\uBD80\uD0C1\uB4DC\uB9BD\uB2C8\uB2E4\.?/gim,
  /\uAC10\uC0AC\uD569\uB2C8\uB2E4\.?/gim,
  /\uCF54\uBE44\uC83C\s*CS\uC0AC\uC5C5\uBCF8\uBD80[\s\S]*$/i,
  /\uB0B4\uC120\uBC88\uD638\s*:\s*[\d-]+/gi
];
const FALLBACK_MIN_CONFIDENCE = 0.55;
const DEFAULT_LLM_SKIP_MIN_CONFIDENCE = 0.75;
const LLM_SKIP_CHUNK_TYPES = new Set(["qa_pair", "resolution"]);
const EXPLANATION_QUERY_PATTERNS: RegExp[] = [
  /어떻게/i,
  /방법/i,
  /하는\s*법/i,
  /가이드/i,
  /절차/i,
  /설정/i,
  /추가/i,
  /코드/i,
  /구성/i
];

function toShortSummary(text: string | null | undefined, maxLength: number): string | null {
  const cleaned = cleanSupportText(text);
  if (!cleaned) {
    return null;
  }
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function buildSimilarIssueUrl(requireId: string): string {
  const query = new URLSearchParams({
    req_id: requireId,
    system: "Menu01",
    alias: "Menu01.Service.List",
    mnid: "705"
  });
  return `${COVISION_SERVICE_VIEW_BASE_URL}?${query.toString()}`;
}

function extractAnswerSection(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/\[ANSWER\]\s*([\s\S]*)$/i);
  const answerBlock = match ? match[1] : normalized;

  let stripped = answerBlock;
  for (const pattern of ANSWER_NOISE_PATTERNS) {
    stripped = stripped.replace(pattern, " ");
  }
  stripped = repairStrippedS(stripped).replace(/\s+/g, " ").trim();

  return stripped.length > 0 ? stripped : repairStrippedS(answerBlock).replace(/\s+/g, " ").trim();
}

function cleanSupportText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }

  let stripped = text.replace(/\[QUESTION\]|\[ANSWER\]/gi, " ");
  for (const pattern of ANSWER_NOISE_PATTERNS) {
    stripped = stripped.replace(pattern, " ");
  }
  stripped = repairStrippedS(stripped).replace(/\s+/g, " ").trim();
  return stripped.length > 0 ? stripped : null;
}

function buildDeterministicAnswer(result: ChatResponseBody, similarIssueUrl: string | null): string | null {
  if (!result.bestAnswerText) {
    return null;
  }

  const resolutionSummary = toShortSummary(
    extractAnswerSection(result.bestAnswerText) || result.bestResolutionText || result.bestActionText,
    260
  );
  if (!resolutionSummary) {
    return null;
  }

  const issueSummary = toShortSummary(result.bestIssueText ?? result.bestQaPairText, 120);
  const actionSummary = toShortSummary(result.bestActionText, 180);

  const parts = ["1) \uD575\uC2EC \uC548\uB0B4", "\uC720\uC0AC \uC0AC\uB840 \uAE30\uC900\uC73C\uB85C \uD655\uC778\uB41C \uCC98\uB9AC \uC774\uB825\uC744 \uC548\uB0B4\uB4DC\uB9BD\uB2C8\uB2E4."];
  if (issueSummary) {
    parts.push("", "2) \uC720\uC0AC \uC0AC\uB840", issueSummary);
  }
  parts.push("", "3) \uCC98\uB9AC \uB0B4\uC5ED", resolutionSummary);
  parts.push("", "4) \uD655\uC778 \uD3EC\uC778\uD2B8");
  if (actionSummary) {
    parts.push(`- ${actionSummary}`);
  } else {
    parts.push("- \uD604\uC7AC \uC99D\uC0C1 \uC7AC\uD604 \uC5EC\uBD80\uC640 \uAD00\uB828 \uC124\uC815\uAC12\uC744 \uD568\uAED8 \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
  }
  if (similarIssueUrl) {
    parts.push("", "5) \uCC38\uACE0 \uB9C1\uD06C", similarIssueUrl);
  }

  return parts.join("\n");
}

function ensureAnswerHasSimilarLink(answer: string | null, similarIssueUrl: string | null): string | null {
  if (!answer) {
    return null;
  }
  if (!similarIssueUrl || answer.includes(similarIssueUrl)) {
    return answer;
  }
  return `${answer}\n\n\uCC38\uACE0 \uB9C1\uD06C: ${similarIssueUrl}`;
}

function buildSafeDefaultAnswer(similarIssueUrl: string | null, hasCandidate: boolean): string {
  if (hasCandidate) {
    const parts = [
      "1) \uD575\uC2EC \uC548\uB0B4",
      "\uC9C8\uBB38\uACFC \uC720\uC0AC\uD55C \uCC98\uB9AC \uC774\uB825 \uD6C4\uBCF4\uB97C \uCC3E\uC558\uC2B5\uB2C8\uB2E4. \uC0C1\uC138 \uC774\uB825\uC740 \uC544\uB798 \uB9C1\uD06C\uC5D0\uC11C \uD655\uC778\uD574 \uC8FC\uC138\uC694."
    ];
    if (similarIssueUrl) {
      parts.push("", "2) \uCC38\uACE0 \uB9C1\uD06C", similarIssueUrl);
    }
    return parts.join("\n");
  }

  return [
    "1) \uD575\uC2EC \uC548\uB0B4",
    "\uD604\uC7AC \uD6C4\uBCF4 \uC774\uB825\uC5D0\uC11C \uC9C8\uBB38\uACFC \uC815\uD655\uD788 \uC77C\uCE58\uD558\uB294 \uC0AC\uB840\uB97C \uD2B9\uC815\uD558\uAE30 \uC5B4\uB835\uC2B5\uB2C8\uB2E4.",
    "",
    "2) \uCD94\uAC00 \uD655\uC778 \uC694\uCCAD",
    "\uC624\uB958 \uBA54\uC2DC\uC9C0, \uD654\uBA74 \uACBD\uB85C, \uC7AC\uD604 \uC870\uAC74\uC744 \uD568\uAED8 \uC8FC\uC2DC\uBA74 \uC7AC\uD0D0\uC0C9\uD558\uACA0\uC2B5\uB2C8\uB2E4."
  ].join("\n");
}

function isManualNoiseLine(line: string, candidateTitle: string): boolean {
  if (!line) {
    return true;
  }
  if (line === candidateTitle) {
    return true;
  }
  if (/^[\u2460-\u2473]$/u.test(line) || /^\d+$/.test(line)) {
    return true;
  }
  if (/^\d+(?:\.\d+){1,4}\.?\s+.+\s+\d+$/u.test(line)) {
    return true;
  }
  if (/\uC81C\.?\uAC1C\uC815\s*\uC774\uB825\uC11C|revision history|version\s*:/i.test(line)) {
    return true;
  }
  if (/storage\/emulated|android\/data|content:\/\/|\.png|\.jpe?g|\.gif|\.wav|\.mp4|sample_\w+|permission/i.test(line)) {
    return true;
  }

  const koreanChars = line.match(/[가-힣]/gu)?.length ?? 0;
  const noisySymbols = line.match(/[\\/_<>{}[\]|]/g)?.length ?? 0;
  if (line.length >= 40 && koreanChars === 0 && noisySymbols >= 4) {
    return true;
  }
  return false;
}

function normalizeManualEvidenceLine(line: string): string {
  return repairStrippedS(line)
    .replace(/^[\u2460-\u2473]\s*/u, "")
    .replace(/^\d+[.)]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isManualPathLine(line: string): boolean {
  return /경로\s*[:：]/u.test(line) || /메뉴\s*[:：]/u.test(line);
}

function isManualActionLine(line: string): boolean {
  return /클릭|선택|입력|저장|추가|조회|신청|설정|지정|확인|표시|이동|등록|생성|수정|삭제|활성|비활성|변경|작성/u.test(line);
}

function getManualEvidenceScope(candidate: ManualCandidate): string[] {
  const rawLines = candidate.previewText
    .split(/\r?\n/)
    .map(normalizeManualEvidenceLine)
    .filter((line) => !isManualNoiseLine(line, candidate.title));

  const pathIndex = rawLines.findIndex(isManualPathLine);
  return pathIndex >= 0 ? rawLines.slice(pathIndex, pathIndex + 24) : rawLines;
}

function buildManualEvidenceLines(candidate: ManualCandidate): string[] {
  const scopedLines = getManualEvidenceScope(candidate);
  const result: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < scopedLines.length; index += 1) {
    const line = scopedLines[index];
    if (!line || seen.has(line)) {
      continue;
    }

    const next = scopedLines[index + 1] ?? "";
    const shouldPairWithNext =
      line.length <= 16 &&
      next.length > 0 &&
      next.length <= 140 &&
      !isManualNoiseLine(next, candidate.title) &&
      !next.includes("\uACBD\uB85C") &&
      !/[:\uFF1A.]$/u.test(line);
    const summaryLine = shouldPairWithNext ? `${line}: ${next}` : line;
    result.push(summaryLine.length > 160 ? `${summaryLine.slice(0, 160)}...` : summaryLine);
    seen.add(line);
    if (shouldPairWithNext) {
      seen.add(next);
      index += 1;
    }
    if (result.length >= 7) {
      break;
    }
  }

  return result;
}

function extractManualScreenLabel(text: string): string | null {
  const match = text.match(/<\s*([^<>]{4,120})\s*>/u);
  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function buildManualProcedureLines(candidate: ManualCandidate, pathLine: string | undefined): string[] {
  const scopedLines = getManualEvidenceScope(candidate)
    .filter((line) => line !== pathLine)
    .filter((line) => line.length >= 6 && line.length <= 180);
  const seen = new Set<string>();
  const actionLines: string[] = [];
  const contextLines: string[] = [];

  for (const line of scopedLines) {
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);

    if (isManualActionLine(line)) {
      actionLines.push(line);
    } else if (!/^\d+$/u.test(line)) {
      contextLines.push(line);
    }
  }

  const selected = actionLines.length > 0 ? actionLines : contextLines;
  return selected.slice(0, 4).map((line) => (line.length > 150 ? `${line.slice(0, 150)}...` : line));
}

function buildManualAnswer(candidate: ManualCandidate | null): string | null {
  if (!candidate) {
    return null;
  }

  const displaySection = extractManualScreenLabel(candidate.previewText) ?? candidate.sectionTitle;
  const evidenceLines = buildManualEvidenceLines(candidate);
  const pathLine = evidenceLines.find(isManualPathLine);
  const procedureLines = buildManualProcedureLines(candidate, pathLine);
  const parts = [
    "1) \uD575\uC2EC \uC548\uB0B4",
    `사용자 매뉴얼 "${candidate.title}" 기준으로 확인한 절차입니다.`,
    "",
    "2) 확인 위치",
    pathLine ? `- ${pathLine}` : `- 관련 화면: ${displaySection ?? candidate.sectionTitle ?? candidate.title}`,
    "",
    "3) 진행 순서",
    ...(procedureLines.length > 0
      ? procedureLines.map((line) => `- ${line}`)
      : ["- 매뉴얼 본문에서 관련 화면의 버튼명과 입력 항목을 확인해 주세요."]),
    "",
    "4) 확인 포인트",
    "- 실제 화면에서는 사용자 권한과 사용 중인 제품 버전에 따라 메뉴명이나 버튼 위치가 일부 다를 수 있습니다.",
    candidate.previewImageUrl
      ? "- 답변 카드의 화면 미리보기를 함께 확인하면 절차를 더 빠르게 따라갈 수 있습니다."
      : "- 화면 이미지가 필요한 경우 원본 매뉴얼을 열어 해당 화면 기준으로 확인해 주세요.",
    candidate.linkUrl
      ? "- 아래 사용자 매뉴얼 링크에서 원문을 확인할 수 있습니다."
      : "- 보안 정책상 원본 매뉴얼 다운로드는 현재 비활성화되어 있습니다. 필요한 경우 문서명 기준으로 내부 문서 저장소에서 확인해 주세요."
  ];

  if (candidate.linkUrl) {
    parts.push("", "5) \uCC38\uACE0 \uB9C1\uD06C", candidate.linkUrl);
  }

  return parts.join("\n");
}

function isManualDownloadEnabled(): boolean {
  const raw = process.env.MANUAL_DOWNLOAD_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return ["1", "true", "on", "yes"].includes(raw);
}

function isManualPreviewEnabled(): boolean {
  const raw = process.env.MANUAL_PREVIEW_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return ["1", "true", "on", "yes"].includes(raw);
}

function getManualPreviewRoot(): string | null {
  const raw = process.env.MANUAL_PREVIEW_DIR?.trim();
  return raw ? resolve(raw) : null;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function resolveManualPreviewPath(documentId: string, chunkId: string): string | null {
  const root = getManualPreviewRoot();
  if (!root) {
    return null;
  }
  const filePath = resolve(root, documentId, `${chunkId}.png`);
  if (!filePath.startsWith(`${root}${sep}`)) {
    return null;
  }
  return filePath;
}

function buildDisplayPayload(args: {
  answerText: string;
  requireId: string | null;
  sccId: string | null;
  linkUrl: string | null;
  confidence: number;
  answerSource: ChatResponseBody["answerSource"];
  retrievalMode: ChatResponseBody["retrievalMode"];
}): NonNullable<ChatResponseBody["display"]> {
  const isManual = args.answerSource === "manual";
  const isClarification = args.answerSource === "clarification";
  const hasMatch = args.requireId !== null || isManual;
  return {
    status: hasMatch ? "matched" : "needs_more_info",
    title: isManual
      ? "사용자 매뉴얼을 찾았습니다."
      : isClarification
        ? "추가 정보가 필요합니다."
        : hasMatch
          ? "유사 처리 이력을 찾았습니다."
          : "추가 정보가 필요합니다.",
    answerText: args.answerText,
    linkLabel: hasMatch && args.linkUrl ? (isManual ? "사용자 매뉴얼 열기" : "유사 이력 바로가기") : null,
    linkUrl: hasMatch ? args.linkUrl : null,
    requireId: args.requireId,
    sccId: args.sccId,
    confidence: args.confidence,
    answerSource: args.answerSource ?? null,
    retrievalMode: args.retrievalMode
  };
}

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvBoolean(raw: string | undefined, fallback: boolean): boolean {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseEnvInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return value?.trim() || null;
}

function resolveRateLimitKey(request: FastifyRequest): string {
  const realIp = firstHeaderValue(request.headers["x-real-ip"]);
  if (realIp) {
    return realIp;
  }
  const forwardedFor = firstHeaderValue(request.headers["x-forwarded-for"]);
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || request.ip;
  }
  return request.ip;
}

function parseRateLimitAllowList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveRateLimitGroup(url: string): string {
  const path = url.split("?")[0] ?? url;
  if (path === "/health" || path === "/test/chat") return "unlimited";
  if (path === "/chat/stream") return "chat-stream";
  if (path === "/chat") return "chat-json";
  if (path === "/retrieval/search") return "retrieval-search";
  if (path === "/feedback") return "feedback";
  if (path === "/admin/logs") return "admin-logs";
  if (path.startsWith("/conversations")) return "conversations";
  return "default";
}

function resolveRateLimitMax(url: string): number {
  const group = resolveRateLimitGroup(url);
  switch (group) {
    case "chat-stream":
      return parseEnvInteger(process.env.RATE_LIMIT_CHAT_STREAM_MAX, 20);
    case "chat-json":
      return parseEnvInteger(process.env.RATE_LIMIT_CHAT_MAX, 30);
    case "retrieval-search":
      return parseEnvInteger(process.env.RATE_LIMIT_RETRIEVAL_MAX, 60);
    case "feedback":
      return parseEnvInteger(process.env.RATE_LIMIT_FEEDBACK_MAX, 120);
    case "admin-logs":
      return parseEnvInteger(process.env.RATE_LIMIT_ADMIN_MAX, 120);
    case "conversations":
      return parseEnvInteger(process.env.RATE_LIMIT_CONVERSATION_MAX, 120);
    case "unlimited":
      return Number.MAX_SAFE_INTEGER;
    default:
      return parseEnvInteger(process.env.RATE_LIMIT_DEFAULT_MAX, 300);
  }
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitEvent {
  blockedAt: string;
  group: string;
  path: string;
  method: string;
  ip: string;
  max: number;
  resetInSeconds: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const rateLimitEvents: RateLimitEvent[] = [];

function pruneRateLimitBuckets(now: number, maxEntries: number): void {
  if (rateLimitBuckets.size <= maxEntries) {
    return;
  }
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now || rateLimitBuckets.size > maxEntries) {
      rateLimitBuckets.delete(key);
    }
    if (rateLimitBuckets.size <= maxEntries) {
      break;
    }
  }
}

function checkRateLimit(request: FastifyRequest): {
  limited: boolean;
  group: string;
  ip: string;
  max: number;
  remaining: number;
  resetInSeconds: number;
} | null {
  if (!parseEnvBoolean(process.env.RATE_LIMIT_ENABLED, true)) {
    return null;
  }

  const group = resolveRateLimitGroup(request.url);
  if (group === "unlimited") {
    return null;
  }

  const ip = resolveRateLimitKey(request);
  if (parseRateLimitAllowList(process.env.RATE_LIMIT_ALLOW_LIST).includes(ip)) {
    return null;
  }

  const max = resolveRateLimitMax(request.url);
  const timeWindowMs = parseEnvInteger(process.env.RATE_LIMIT_TIME_WINDOW_MS, 60_000);
  const now = Date.now();
  const key = `${group}:${ip}`;
  const cacheSize = parseEnvInteger(process.env.RATE_LIMIT_CACHE_SIZE, 10_000);
  pruneRateLimitBuckets(now, cacheSize);

  const current = rateLimitBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + timeWindowMs }
    : current;

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  const resetInSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return {
    limited: bucket.count > max,
    group,
    ip,
    max,
    remaining: Math.max(0, max - bucket.count),
    resetInSeconds,
  };
}

function maskRateLimitIp(ip: string): string {
  const normalized = ip.trim();
  const ipv4Parts = normalized.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((part) => /^\d{1,3}$/.test(part))) {
    return `${ipv4Parts.slice(0, 3).join(".")}.*`;
  }
  if (normalized.includes(":")) {
    return `${normalized.split(":").slice(0, 3).join(":")}:*`;
  }
  return normalized || "unknown";
}

function recordRateLimitEvent(request: FastifyRequest, rateLimit: NonNullable<ReturnType<typeof checkRateLimit>>): void {
  const maxEvents = parseEnvInteger(process.env.RATE_LIMIT_EVENT_LOG_SIZE, 500);
  rateLimitEvents.push({
    blockedAt: new Date().toISOString(),
    group: rateLimit.group,
    path: request.url.split("?")[0] ?? request.url,
    method: request.method,
    ip: maskRateLimitIp(rateLimit.ip),
    max: rateLimit.max,
    resetInSeconds: rateLimit.resetInSeconds,
  });
  if (rateLimitEvents.length > maxEvents) {
    rateLimitEvents.splice(0, rateLimitEvents.length - maxEvents);
  }
}

function getRateLimitMonitoring(days: number) {
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);
  const filtered = rateLimitEvents.filter((event) => new Date(event.blockedAt).getTime() >= since);
  const byGroup = Array.from(
    filtered.reduce((acc, event) => {
      const current = acc.get(event.group) ?? {
        group: event.group,
        blocked_count: 0,
        latest_at: event.blockedAt,
      };
      current.blocked_count += 1;
      if (new Date(event.blockedAt).getTime() > new Date(current.latest_at).getTime()) {
        current.latest_at = event.blockedAt;
      }
      acc.set(event.group, current);
      return acc;
    }, new Map<string, { group: string; blocked_count: number; latest_at: string }>())
  ).map(([, value]) => value)
    .sort((a, b) => b.blocked_count - a.blocked_count || b.latest_at.localeCompare(a.latest_at));

  return {
    enabled: parseEnvBoolean(process.env.RATE_LIMIT_ENABLED, true),
    windowMs: parseEnvInteger(process.env.RATE_LIMIT_TIME_WINDOW_MS, 60_000),
    bucketCount: rateLimitBuckets.size,
    eventBufferSize: rateLimitEvents.length,
    blockedCount: filtered.length,
    latestBlockedAt: filtered.at(-1)?.blockedAt ?? null,
    byGroup,
    recent: filtered.slice(-20).reverse(),
  };
}

function buildEmbeddingCoverageAlert(args: {
  available: boolean;
  sourceChunkRows: number;
  minCoveragePct: number | null;
  pendingChunks: number;
  ingestState: EmbeddingCoverageSnapshot["ingestState"];
  error?: string | null;
}): EmbeddingCoverageAlert {
  const warnMinCoveragePct = parseEnvNumber(process.env.EMBEDDING_COVERAGE_WARN_MIN_PCT, 99);
  const criticalMinCoveragePct = parseEnvNumber(process.env.EMBEDDING_COVERAGE_CRITICAL_MIN_PCT, 95);
  const warnPendingChunks = parseEnvInteger(process.env.EMBEDDING_COVERAGE_WARN_PENDING_CHUNKS, 500);
  const criticalPendingChunks = parseEnvInteger(process.env.EMBEDDING_COVERAGE_CRITICAL_PENDING_CHUNKS, 2_000);
  const reasons: string[] = [];
  let level: EmbeddingCoverageAlertLevel = "ok";

  if (!args.available) {
    reasons.push(args.error ? `커버리지 조회 실패: ${args.error}` : "커버리지 조회 실패");
    level = "critical";
  }

  if (args.sourceChunkRows > 0 && args.minCoveragePct === null) {
    reasons.push("source chunk는 있으나 임베딩 모델별 커버리지 데이터가 없습니다.");
    level = "critical";
  }

  if (args.minCoveragePct !== null) {
    if (args.minCoveragePct < criticalMinCoveragePct) {
      reasons.push(`최저 커버리지 ${args.minCoveragePct}% < critical ${criticalMinCoveragePct}%`);
      level = "critical";
    } else if (args.minCoveragePct < warnMinCoveragePct && level !== "critical") {
      reasons.push(`최저 커버리지 ${args.minCoveragePct}% < warn ${warnMinCoveragePct}%`);
      level = "warning";
    }
  }

  if (args.pendingChunks >= criticalPendingChunks && criticalPendingChunks > 0) {
    reasons.push(`미임베딩 추정 ${args.pendingChunks}건 >= critical ${criticalPendingChunks}건`);
    level = "critical";
  } else if (args.pendingChunks >= warnPendingChunks && warnPendingChunks > 0 && level !== "critical") {
    reasons.push(`미임베딩 추정 ${args.pendingChunks}건 >= warn ${warnPendingChunks}건`);
    level = "warning";
  }

  const latestStatus = args.ingestState[0]?.last_status?.toLowerCase() ?? null;
  if (latestStatus === "error" && level !== "critical") {
    reasons.push("최근 ingest 상태가 error입니다.");
    level = "warning";
  }

  return {
    level,
    message:
      level === "critical"
        ? "임베딩 커버리지 확인이 필요합니다."
        : level === "warning"
          ? "임베딩 커버리지 주의가 필요합니다."
          : "임베딩 커버리지가 정상 범위입니다.",
    reasons,
    warnMinCoveragePct,
    criticalMinCoveragePct,
    warnPendingChunks,
    criticalPendingChunks,
  };
}

async function getEmbeddingCoverageMonitoring(options: { useCache?: boolean } = {}): Promise<EmbeddingCoverageSnapshot> {
  const cacheTtlMs = parseEnvInteger(process.env.EMBEDDING_COVERAGE_CACHE_TTL_MS, 60_000);
  if (options.useCache && embeddingCoverageCache && embeddingCoverageCache.expiresAt > Date.now()) {
    return embeddingCoverageCache.snapshot;
  }

  const pool = getVectorPool();
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("begin");
    await client.query("set local statement_timeout = '5000ms'");

    const sourceObjectResult = await client.query<{ source_object: string | null }>(
      `select to_regclass('ai_core.mv_scc_chunk_preview')::text as source_object`
    );
    const sourceObject = sourceObjectResult.rows[0]?.source_object === "ai_core.mv_scc_chunk_preview"
      ? "ai_core.mv_scc_chunk_preview"
      : "ai_core.v_scc_chunk_preview";
    const sourceCountResult = await client.query<{ source_chunk_rows: number }>(
      `select count(*)::int as source_chunk_rows
         from ${sourceObject}`
    );
    const statusResult = await client.query<{
      embedding_model: string;
      embedding_rows: number;
      embedded_chunks: number;
      last_embedded_at: Date | null;
      last_updated_at: Date | null;
    }>(
      `select
          embedding_model,
          count(*)::int as embedding_rows,
          count(distinct chunk_id)::int as embedded_chunks,
          max(embedded_at) as last_embedded_at,
          max(updated_at) as last_updated_at
         from ai_core.scc_chunk_embeddings
        group by embedding_model
        order by last_updated_at desc nulls last, embedding_model asc`
    );
    const ingestStateResult = await client.query(
      `select
          state_key,
          last_source_ingested_at,
          last_run_at,
          last_status,
          last_message,
          updated_at
         from ai_core.embedding_ingest_state
        order by updated_at desc nulls last
        limit 5`
    );
    await client.query("commit");

    const sourceChunkRows = Number(sourceCountResult.rows[0]?.source_chunk_rows ?? 0);
    const coverageRows = statusResult.rows.map((row) => {
      const embeddedChunks = Number(row.embedded_chunks ?? 0);
      const coveragePct = sourceChunkRows > 0
        ? Math.round((embeddedChunks / sourceChunkRows) * 10_000) / 100
        : null;
      return {
        embedding_model: row.embedding_model,
        source_chunk_rows: sourceChunkRows,
        embedded_chunks: embeddedChunks,
        coverage_pct: coveragePct,
      };
    }).sort((a, b) => (a.coverage_pct ?? 0) - (b.coverage_pct ?? 0) || a.embedding_model.localeCompare(b.embedding_model));
    const minCoveragePct = coverageRows.reduce((min, row) => {
      const coveragePct = Number(row.coverage_pct ?? 0);
      return Math.min(min, coveragePct);
    }, coverageRows.length > 0 ? Number.POSITIVE_INFINITY : 0);
    const pendingChunks = coverageRows.length === 0 ? sourceChunkRows : coverageRows.reduce((sum, row) => {
      const sourceRows = Number(row.source_chunk_rows ?? 0);
      const embeddedRows = Number(row.embedded_chunks ?? 0);
      return sum + Math.max(0, sourceRows - embeddedRows);
    }, 0);

    const snapshot: EmbeddingCoverageSnapshot = {
      available: true,
      sourceChunkRows,
      minCoveragePct: Number.isFinite(minCoveragePct) ? minCoveragePct : null,
      pendingChunks,
      coverage: coverageRows,
      status: statusResult.rows,
      ingestState: ingestStateResult.rows,
      alert: buildEmbeddingCoverageAlert({
        available: true,
        sourceChunkRows,
        minCoveragePct: Number.isFinite(minCoveragePct) ? minCoveragePct : null,
        pendingChunks,
        ingestState: ingestStateResult.rows,
      }),
      error: null,
    };
    embeddingCoverageCache = { snapshot, expiresAt: Date.now() + cacheTtlMs };
    return snapshot;
  } catch (error) {
    if (client) {
      try {
        await client.query("rollback");
      } catch {
        // Ignore rollback errors after a failed monitoring-only query.
      }
    }
    const errorMessage = error instanceof Error ? error.message : "EMBEDDING_COVERAGE_QUERY_FAILED";
    const snapshot: EmbeddingCoverageSnapshot = {
      available: false,
      sourceChunkRows: 0,
      minCoveragePct: null,
      pendingChunks: 0,
      coverage: [],
      status: [],
      ingestState: [],
      alert: buildEmbeddingCoverageAlert({
        available: false,
        sourceChunkRows: 0,
        minCoveragePct: null,
        pendingChunks: 0,
        ingestState: [],
        error: errorMessage,
      }),
      error: errorMessage,
    };
    embeddingCoverageCache = { snapshot, expiresAt: Date.now() + Math.min(cacheTtlMs, 30_000) };
    return snapshot;
  } finally {
    client?.release();
  }
}

function createEmbeddingCoverageHealthFallback(message: string): EmbeddingCoverageSnapshot {
  return {
    available: false,
    sourceChunkRows: 0,
    minCoveragePct: null,
    pendingChunks: 0,
    coverage: [],
    status: [],
    ingestState: [],
    alert: {
      level: "warning",
      message: "임베딩 커버리지 health 조회가 지연되었습니다.",
      reasons: [message],
      warnMinCoveragePct: parseEnvNumber(process.env.EMBEDDING_COVERAGE_WARN_MIN_PCT, 99),
      criticalMinCoveragePct: parseEnvNumber(process.env.EMBEDDING_COVERAGE_CRITICAL_MIN_PCT, 95),
      warnPendingChunks: parseEnvInteger(process.env.EMBEDDING_COVERAGE_WARN_PENDING_CHUNKS, 500),
      criticalPendingChunks: parseEnvInteger(process.env.EMBEDDING_COVERAGE_CRITICAL_PENDING_CHUNKS, 2_000),
    },
    error: message,
  };
}

async function getEmbeddingCoverageHealthSnapshot(): Promise<EmbeddingCoverageSnapshot> {
  const timeoutMs = parseEnvInteger(process.env.EMBEDDING_COVERAGE_HEALTH_TIMEOUT_MS, 1_500);
  const probe = embeddingCoverageHealthProbeInFlight ?? getEmbeddingCoverageMonitoring({ useCache: true }).finally(() => {
    embeddingCoverageHealthProbeInFlight = null;
  });
  embeddingCoverageHealthProbeInFlight = probe;

  return Promise.race([
    probe,
    new Promise<EmbeddingCoverageSnapshot>((resolve) => {
      setTimeout(() => {
        resolve(createEmbeddingCoverageHealthFallback(`health 조회 제한 시간 ${timeoutMs}ms를 초과했습니다.`));
      }, timeoutMs);
    }),
  ]);
}

function requiresExplanatoryAnswer(query: string): boolean {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return false;
  }
  return EXPLANATION_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function shouldSkipLlm(query: string, result: ChatResponseBody): boolean {
  const enabled = parseEnvBoolean(process.env.LLM_SKIP_ON_HIGH_CONFIDENCE, true);
  if (!enabled) {
    return false;
  }
  if (requiresExplanatoryAnswer(query)) {
    return false;
  }

  const threshold = parseEnvNumber(process.env.LLM_SKIP_MIN_CONFIDENCE, DEFAULT_LLM_SKIP_MIN_CONFIDENCE);
  if (result.bestRequireId === null || result.bestAnswerText === null) {
    return false;
  }
  if (result.confidence < threshold) {
    return false;
  }
  if (!result.bestChunkType || !LLM_SKIP_CHUNK_TYPES.has(result.bestChunkType)) {
    return false;
  }
  return true;
}

export function buildServer(): FastifyInstance {
  const app = Fastify({
    trustProxy: parseEnvBoolean(process.env.TRUST_PROXY, true),
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  // 주기적 캐시 정리 시작 (1분마다)
  startCacheCleanupInterval(60_000);
  startLlmCacheCleanupInterval(60_000);

  // 쿼리 결과 캐시 만료 항목 정리 (5분마다)
  const queryCacheCleanupTimer = setInterval(evictExpiredEntries, 5 * 60_000);
  queryCacheCleanupTimer.unref?.();

  // HNSW 인덱스 버퍼 캐시 워밍업 (서버 시작 후 첫 요청 지연 방지)
  setTimeout(async () => {
    try {
      const pool = getVectorPool();
      const warmupVec = Array.from({ length: 768 }, () => 0.1);
      const literal = `[${warmupVec.join(",")}]`;
      await pool.query(
        `SELECT chunk_id FROM ai_core.scc_chunk_embeddings
         WHERE embedding_model = 'google:gemini-embedding-2-preview'
         ORDER BY (embedding_vec::vector(768)) <=> $1::vector(768)
         LIMIT 1`,
        [literal]
      );
      app.log.info("HNSW index warmup complete");
    } catch (e) {
      app.log.warn("HNSW index warmup failed (non-critical): " + String(e));
    }
  }, 3000);

  // 자동 임베스트 스케줄러
  const ingestScheduler: IngestSchedulerHandle = startIngestScheduler({
    info: (msg) => app.log.info(msg),
    warn: (msg) => app.log.warn(msg),
    error: (msg) => app.log.error(msg),
  });

  // Development allowlist for browser calls from local JSP/UI.
  void app.register(fastifyCors, {
    origin: [
      "http://localhost:8080",
      "http://127.0.0.1:8080"
    ]
  });

  app.addHook("onRequest", async (request, reply) => {
    const rateLimit = checkRateLimit(request);
    if (!rateLimit) {
      return;
    }

    reply
      .header("x-ratelimit-limit", rateLimit.max)
      .header("x-ratelimit-remaining", rateLimit.remaining)
      .header("x-ratelimit-reset", rateLimit.resetInSeconds);

    if (rateLimit.limited) {
      recordRateLimitEvent(request, rateLimit);
      request.log.warn({
        group: rateLimit.group,
        path: request.url.split("?")[0] ?? request.url,
        ip: maskRateLimitIp(rateLimit.ip),
        max: rateLimit.max,
        resetInSeconds: rateLimit.resetInSeconds,
      }, "rate limit exceeded");
      reply.header("retry-after", rateLimit.resetInSeconds);
      return reply.code(429).send({
        statusCode: 429,
        error: "TOO_MANY_REQUESTS",
        message: `요청이 너무 많습니다. ${rateLimit.resetInSeconds}초 후 다시 시도해 주세요.`,
        retryAfter: rateLimit.resetInSeconds,
      });
    }
  });

  app.get("/health", async () => {
    const embeddingCoverage = await getEmbeddingCoverageHealthSnapshot();
    return {
      status: "ok",
      service: "workspace-fastify",
      build: getBuildInfo(),
      cache: getCacheStats(),
      queryEmbedding: getQueryEmbeddingRuntimeStatus(),
      embeddingCoverage: {
        available: embeddingCoverage.available,
        sourceChunkRows: embeddingCoverage.sourceChunkRows,
        minCoveragePct: embeddingCoverage.minCoveragePct,
        pendingChunks: embeddingCoverage.pendingChunks,
        alert: embeddingCoverage.alert,
        error: embeddingCoverage.error,
      },
    };
  });

  app.get("/test/chat", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderChatTestPage());
  });

  app.get<{ Params: { documentId: string } }>("/manual/documents/:documentId", async (request, reply) => {
    if (!isManualDownloadEnabled()) {
      return reply.code(404).send({ error: "MANUAL_DOWNLOAD_DISABLED" });
    }

    const documentId = request.params.documentId?.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) {
      return reply.code(400).send({ error: "INVALID_DOCUMENT_ID" });
    }

    try {
      const result = await getVectorPool().query<{
        sourcePath: string;
        title: string;
      }>(
        `
        select source_path as "sourcePath", title
        from ai_core.manual_documents
        where document_id = $1::uuid
          and audience = 'user'
        limit 1
        `,
        [documentId]
      );
      const document = result.rows[0];
      if (!document) {
        return reply.code(404).send({ error: "MANUAL_DOCUMENT_NOT_FOUND" });
      }

      await statFile(document.sourcePath);
      const fileName = `${document.title || basename(document.sourcePath, ".docx")}.docx`;
      reply.header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      return reply.send(createReadStream(document.sourcePath));
    } catch (error) {
      request.log.warn({ error, documentId }, "failed to download manual document");
      return reply.code(404).send({ error: "MANUAL_DOCUMENT_UNAVAILABLE" });
    }
  });

  app.get<{ Params: { documentId: string; chunkId: string } }>(
    "/manual/previews/:documentId/:chunkId",
    async (request, reply) => {
      if (!isManualPreviewEnabled()) {
        return reply.code(404).send({ error: "MANUAL_PREVIEW_DISABLED" });
      }

      const documentId = request.params.documentId?.trim();
      const chunkId = request.params.chunkId?.trim();
      if (!isUuidLike(documentId) || !isUuidLike(chunkId)) {
        return reply.code(400).send({ error: "INVALID_MANUAL_PREVIEW_ID" });
      }

      const filePath = resolveManualPreviewPath(documentId, chunkId);
      if (!filePath) {
        return reply.code(404).send({ error: "MANUAL_PREVIEW_DIR_NOT_CONFIGURED" });
      }

      try {
        await statFile(filePath);
        reply.header("cache-control", "private, max-age=300");
        reply.header("content-type", "image/png");
        return reply.send(createReadStream(filePath));
      } catch (error) {
        request.log.debug({ error, documentId, chunkId }, "manual preview image not available");
        return reply.code(404).send({ error: "MANUAL_PREVIEW_NOT_FOUND" });
      }
    }
  );

  app.post<{ Body: ChatRequestBody }>("/chat", async (request, reply) => {
    const totalStartedAt = Date.now();
    const logUuid = crypto.randomUUID();
    const query = request.body?.query?.trim();
    const scopeRaw = request.body?.retrievalScope?.trim().toLowerCase();
    const scopeDefault = (process.env.RETRIEVAL_SCOPE_DEFAULT ?? "all").toLowerCase();
    const scope = (scopeRaw ?? scopeDefault) as RetrievalScope;
    const conversationHistory = sanitizeHistory(request.body?.conversationHistory);
    const clientConversationId = request.body?.conversationId?.trim() || null;
    const userKey = request.body?.userKey?.trim() || null;
    let persistenceContext: ConversationPersistenceContext | null = null;

    if (!query) {
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: "`query` is required."

      });
    }

    if (query.length < 2) {
      return reply.code(400).send({
        error: "QUERY_TOO_SHORT",
        message: "`query` must be at least 2 characters."
      });
    }

    if (!["all", "manual", "scc"].includes(scope)) {
      return reply.code(400).send({
        error: "INVALID_SCOPE",
        message: "`retrievalScope` must be one of all|manual|scc."
      });
    }

    try {
      try {
        persistenceContext = await startConversationPersistence({
          clientSessionId: clientConversationId,
          userKey,
          title: buildConversationTitle(query),
          query,
          retrievalScope: scope,
        });
      } catch (error) {
        request.log.warn(error, "failed to persist conversation user turn before /chat response");
      }

      const rewrite = await rewriteQueryForRetrieval(query, conversationHistory);
      const effectiveQuery = rewrite.rewrittenQuery;

      const retrievalStartedAt = Date.now();
      const result = await runChatSearch(effectiveQuery, scope, conversationHistory);
      const retrievalMs = Date.now() - retrievalStartedAt;
      const selectedManualCandidate =
        result.bestChunkType === "manual" ? result.manualCandidates?.[0] ?? null : null;
      const hasManualClarification =
        result.bestChunkType === "manual_clarification" && result.bestAnswerText !== null;
      const hasManualMatch = selectedManualCandidate !== null && result.bestAnswerText !== null;
      const hasRetrievalMatch = result.bestRequireId !== null || hasManualMatch || hasManualClarification;

      // Log detailed timing breakdown for performance analysis
      request.log.info(
        {
          retrievalMs,
          timings: result.timings,
          hasMatch: hasRetrievalMatch,
          vectorUsed: result.vectorUsed,
          queryRewritten: rewrite.rewriteUsed,
          rewrittenQuery: rewrite.rewriteUsed ? effectiveQuery : undefined,
        },
        "Retrieval timing breakdown"
      );

      let llmMs = 0;
      let llmSkipped = false;
      let llmSkipReason: string | null = null;
      const explanationRequired = requiresExplanatoryAnswer(query);
      let llmResultRaw = {
        generatedAnswer: null as string | null,
        llmUsed: false,
        llmModel: null as string | null,
        llmError: null as string | null,
        llmSelectedRequireId: null as string | null,
        llmSelectedSccId: null as string | null,
        llmReRanked: false,
        llmRerankUsed: false,
        llmRerankReason: null as string | null
      };

      if (!hasRetrievalMatch) {
        llmSkipped = true;
        llmSkipReason = "NO_RETRIEVAL_MATCH";
      } else if (hasManualClarification) {
        llmSkipped = true;
        llmSkipReason = "MANUAL_CLARIFICATION";
        llmResultRaw.generatedAnswer = result.bestAnswerText;
      } else if (hasManualMatch) {
        llmSkipped = true;
        llmSkipReason = "MANUAL_CANDIDATE";
        llmResultRaw.generatedAnswer = buildManualAnswer(selectedManualCandidate);
      } else if (shouldSkipLlm(query, result)) {
        llmSkipped = true;
        llmSkipReason = `HIGH_CONFIDENCE_${result.bestChunkType ?? "unknown"}`;
        llmResultRaw.generatedAnswer = buildDeterministicAnswer(result, result.similarIssueUrl);
      } else {
        const llmStartedAt = Date.now();
        llmResultRaw = await generateChatAnswer(query, result, conversationHistory);
        llmMs = Date.now() - llmStartedAt;
      }

      const selectedRequireId = hasRetrievalMatch
        ? hasManualMatch || hasManualClarification
          ? null
          : llmResultRaw.llmSelectedRequireId ?? result.bestRequireId
        : null;
      const selectedSccId =
        !hasRetrievalMatch || hasManualMatch || hasManualClarification
          ? null
          : llmResultRaw.llmSelectedSccId ??
        (selectedRequireId
          ? result.candidates.find((candidate) => candidate.requireId === selectedRequireId)?.sccId ??
            result.bestSccId
          : result.bestSccId);
      const selectedUrl = hasManualMatch
        ? selectedManualCandidate.linkUrl
        : selectedRequireId ? buildSimilarIssueUrl(selectedRequireId) : null;

      const normalizedLlmAnswer =
        typeof llmResultRaw.generatedAnswer === "string" ? llmResultRaw.generatedAnswer.trim() : "";
      const llmAnswer = normalizedLlmAnswer.length > 0 ? normalizedLlmAnswer : null;
      const hasUsableLlmAnswer =
        llmResultRaw.llmUsed &&
        llmResultRaw.llmError === null &&
        llmAnswer !== null;

      const shouldForceDeterministic =
        hasRetrievalMatch &&
        !hasManualMatch &&
        !hasManualClarification &&
        result.bestAnswerText !== null &&
        result.confidence >= FALLBACK_MIN_CONFIDENCE &&
        (llmSkipped || !hasUsableLlmAnswer || (llmResultRaw.llmSelectedRequireId === null && !explanationRequired));

      const fallbackAnswer = shouldForceDeterministic ? buildDeterministicAnswer(result, selectedUrl) : null;
      const resolvedBaseAnswer = fallbackAnswer ?? llmAnswer ?? buildSafeDefaultAnswer(selectedUrl, selectedRequireId !== null);
      const finalAnswer = ensureAnswerHasSimilarLink(resolvedBaseAnswer, selectedUrl);
      const answerSource =
        hasManualMatch
          ? "manual"
          : hasManualClarification
          ? "clarification"
          : fallbackAnswer !== null
          ? result.retrievalMode === "rule_only"
            ? "rule_only"
            : "deterministic_fallback"
          : hasUsableLlmAnswer
            ? "llm"
            : result.retrievalMode === "rule_only"
              ? "rule_only"
              : "deterministic_fallback";
      const answerSourceReason =
        hasManualMatch
          ? "MANUAL_CANDIDATE"
          : hasManualClarification
          ? "MANUAL_CLARIFICATION"
          : fallbackAnswer !== null
          ? llmSkipped
            ? llmSkipReason
            : llmResultRaw.llmError ?? "LLM_UNAVAILABLE_OR_FILTERED"
          : hasUsableLlmAnswer
            ? "LLM_GENERATED"
            : selectedRequireId !== null
              ? "SAFE_DEFAULT_WITH_LINK"
              : "SAFE_DEFAULT_NO_MATCH";
      const llmResult = {
        ...llmResultRaw,
        generatedAnswer: finalAnswer,
        llmReRanked:
          llmResultRaw.llmReRanked &&
          llmResultRaw.llmSelectedRequireId !== null &&
          llmResultRaw.llmSelectedRequireId !== result.bestRequireId
      };

      const totalMs = Date.now() - totalStartedAt;

      logQuery({
        logUuid,
        query,
        retrievalScope: scope,
        confidence: result.confidence,
        bestRequireId: selectedRequireId,
        bestSccId: selectedSccId,
        chunkType: result.bestChunkType,
        vectorUsed: result.vectorUsed,
        retrievalMode: result.retrievalMode,
        answerSource,
        llmUsed: llmResult.llmUsed,
        llmSkipped,
        llmSkipReason,
        isNoMatch: false,
        ruleMs: result.timings?.ruleMs,
        embeddingMs: result.timings?.embeddingMs,
        vectorMs: result.timings?.vectorMs,
        rerankMs: result.timings?.rerankMs,
        retrievalMs,
        llmMs,
        totalMs,
      });

      const top3Candidates = (result.candidates ?? []).slice(0, 3);
      if (persistenceContext) {
        try {
          await finishConversationPersistence({
            context: persistenceContext,
            content: finalAnswer ?? "",
            status: answerSource,
            answerSource,
            retrievalMode: result.retrievalMode,
            confidence: result.confidence,
            bestRequireId: selectedRequireId,
            bestSccId: selectedSccId,
            similarIssueUrl: selectedUrl,
            logUuid,
            metadata: {
              top3Candidates,
              manualCandidates: result.manualCandidates ?? [],
              manualCandidateCount: result.manualCandidateCount ?? 0,
              queryRewritten: rewrite.rewriteUsed,
              rewrittenQuery: rewrite.rewriteUsed ? effectiveQuery : null,
              answerSourceReason,
              vectorError: result.vectorError ?? null,
              vectorStrategy: result.vectorStrategy ?? null,
              vectorModelTag: result.vectorModelTag ?? null,
              vectorCandidateCount: result.vectorCandidateCount ?? null,
              llmError: llmResult.llmError ?? null,
              llmSkipReason
            }
          });
        } catch (error) {
          request.log.warn(error, "failed to persist conversation assistant turn before /chat response");
        }
      }

      return reply.code(200).send({
        logId: logUuid,
        conversationId: persistenceContext?.conversationId ?? null,
        userMessageId: persistenceContext?.userMessageId ?? null,
        assistantMessageId: persistenceContext?.assistantMessageId ?? null,
        ...result,
        bestRequireId: selectedRequireId,
        bestSccId: selectedSccId,
        similarIssueUrl: hasRetrievalMatch ? (selectedUrl ?? result.similarIssueUrl) : null,
        answerSource,
        answerSourceReason,
        ...llmResult,
        llmSkipped,
        llmSkipReason,
        queryRewritten: rewrite.rewriteUsed,
        rewrittenQuery: rewrite.rewriteUsed ? effectiveQuery : null,
        display: buildDisplayPayload({
          answerText: finalAnswer ?? "",
          requireId: selectedRequireId,
          sccId: selectedSccId,
          linkUrl: hasRetrievalMatch ? (selectedUrl ?? result.similarIssueUrl) : null,
          confidence: result.confidence,
          answerSource,
          retrievalMode: result.retrievalMode
        }),
        timings: {
          ...(result.timings ?? {
            ruleMs: 0,
            embeddingMs: 0,
            vectorMs: 0,
            rerankMs: 0,
            cacheHit: false
          }),
          rewriteMs: rewrite.rewriteMs,
          retrievalMs,
          llmMs,
          totalMs
        }
      });
    } catch (error) {
      request.log.error(error, "failed to run /chat search");
      return reply.code(500).send({
        error: "CHAT_SEARCH_FAILED",
        message: "Failed to search chunks."
      });
    }
  });

  app.post<{ Body: ChatRequestBody }>("/chat/stream", async (request, reply) => {
    const requestStartedAt = Date.now();
    const logUuid = crypto.randomUUID();
    const query = request.body?.query?.trim();
    const scopeRaw = request.body?.retrievalScope?.trim().toLowerCase();
    const scopeDefault = (process.env.RETRIEVAL_SCOPE_DEFAULT ?? "all").toLowerCase();
    const scope = (scopeRaw ?? scopeDefault) as RetrievalScope;
    const conversationHistory = sanitizeHistory(request.body?.conversationHistory);
    const clientConversationId = request.body?.conversationId?.trim() || null;
    const userKey = request.body?.userKey?.trim() || null;
    let persistenceContext: ConversationPersistenceContext | null = null;
    let persistenceMs = 0;

    if (!query) {
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: "`query` is required."
      });
    }

    if (query.length < 2) {
      return reply.code(400).send({
        error: "QUERY_TOO_SHORT",
        message: "`query` must be at least 2 characters."
      });
    }

    if (!["all", "manual", "scc"].includes(scope)) {
      return reply.code(400).send({
        error: "INVALID_SCOPE",
        message: "`retrievalScope` must be one of all|manual|scc."
      });
    }

    // 보안 차단 키워드 검사
    if (containsBlockedKeyword(query)) {
      request.log.warn({ query }, "Blocked query due to security keywords");
      return reply.code(200).send({
        error: "SECURITY_BLOCKED",
        message: "보안 정책상 해당 질문에 대해서는 답변을 제공할 수 없습니다.\n\n보안 관련 문의는 담당자에게 직접 문의해 주시기 바랍니다."
      });
    }

    try {
      const persistenceStartedAt = Date.now();
      persistenceContext = await startConversationPersistence({
        clientSessionId: clientConversationId,
        userKey,
        title: buildConversationTitle(query),
        query,
        retrievalScope: scope,
      });
      persistenceMs += Date.now() - persistenceStartedAt;
    } catch (error) {
      request.log.warn(error, "failed to persist conversation user turn before /chat/stream flow");
    }

    // 캐시 히트 시 저장된 스트림 결과 재생
    const cachedResult = getCachedResult(query, scope);
    if (cachedResult) {
      request.log.info({ query, scope }, "Cache hit ??replaying cached stream result");
      const cachedStreamTimings = cachedResult.metadata?.streamTimings;
      const cachedMetadata = {
        ...(cachedResult.metadata ?? {}),
        cacheHit: true,
        streamTimings: {
          ...(isRecord(cachedStreamTimings) ? cachedStreamTimings : {}),
          cacheReplayMs: Date.now() - requestStartedAt,
          persistenceMs,
          totalMs: Date.now() - requestStartedAt,
        } satisfies StreamTimingMetadata,
      };
      if (persistenceContext) {
        try {
          const persistenceStartedAt = Date.now();
          await finishConversationPersistence({
            context: persistenceContext,
            content: cachedResult.fullText,
            status: "llm_stream",
            answerSource: "llm_stream",
            retrievalMode: "hybrid",
            logUuid,
            metadata: cachedMetadata
          });
          persistenceMs += Date.now() - persistenceStartedAt;
          cachedMetadata.streamTimings = {
            ...cachedMetadata.streamTimings,
            persistenceMs,
            totalMs: Date.now() - requestStartedAt,
          };
        } catch (error) {
          request.log.warn(error, "failed to persist cached assistant turn before /chat/stream replay");
        }
      }
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.write(`data: ${JSON.stringify({ type: "metadata", data: cachedMetadata })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: "chunk", data: cachedResult.fullText })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: "done", data: {
        conversationId: persistenceContext?.conversationId ?? null,
        userMessageId: persistenceContext?.userMessageId ?? null,
        assistantMessageId: persistenceContext?.assistantMessageId ?? null,
        streamTimings: cachedMetadata.streamTimings
      } })}\n\n`);
      reply.raw.end();
      return;
    }
    // 검색 실행

    try {
      const rewrite = await rewriteQueryForRetrieval(query, conversationHistory);
      const effectiveQuery = rewrite.rewrittenQuery;

      const retrievalStartedAt = Date.now();
      const result = await runChatSearch(effectiveQuery, scope, conversationHistory);
      const retrievalMs = Date.now() - retrievalStartedAt;
      const selectedManualCandidate =
        result.bestChunkType === "manual" ? result.manualCandidates?.[0] ?? null : null;
      const hasManualClarification =
        result.bestChunkType === "manual_clarification" && result.bestAnswerText !== null;
      const hasManualMatch = selectedManualCandidate !== null && result.bestAnswerText !== null;
      const hasRetrievalMatch = result.bestRequireId !== null || hasManualMatch || hasManualClarification;

      // Log detailed timing breakdown for performance analysis
      request.log.info(
        {
          retrievalMs,
          timings: result.timings,
          hasMatch: hasRetrievalMatch,
          vectorUsed: result.vectorUsed
        },
        "Stream retrieval timing breakdown"
      );

      if (!hasRetrievalMatch) {
        const hasCandidates = result.candidates && result.candidates.length > 0;
        const topScore = hasCandidates ? result.candidates[0].score : 0;

        logQuery({
          logUuid,
          query,
          retrievalScope: scope,
          confidence: result.confidence,
          bestRequireId: null,
          vectorUsed: result.vectorUsed,
          retrievalMode: result.retrievalMode,
          isNoMatch: true,
          ruleMs: result.timings?.ruleMs,
          embeddingMs: result.timings?.embeddingMs,
          vectorMs: result.timings?.vectorMs,
          rerankMs: result.timings?.rerankMs,
          retrievalMs: result.timings?.retrievalMs,
          totalMs: Date.now() - requestStartedAt,
        });

        const noMatchMessage = hasCandidates && topScore >= 0.3
          ? "관련된 유사 후보는 찾았지만 정확도가 충분하지 않습니다.\n\n구체적인 증상이나 메뉴명을 포함해서 다시 질문해 주시면 더 정확한 결과를 찾을 수 있습니다."
          : "관련 처리 이력을 찾지 못했습니다.\n\n오류 메시지나 증상을 구체적으로 입력해 주세요.\n메뉴명 또는 기능명을 함께 입력하면 더 나은 결과를 찾을 수 있습니다.\n예: '전자결재 상신 버튼이 안 보여요', '급여 계산 오류 발생'";

        if (persistenceContext) {
          try {
            const persistenceStartedAt = Date.now();
            await finishConversationPersistence({
              context: persistenceContext,
              content: noMatchMessage,
              status: "no_match",
              answerSource: "rule_only",
              retrievalMode: result.retrievalMode,
              confidence: result.confidence,
              logUuid,
              metadata: {
                hasCandidates,
                topScore,
                top3Candidates: (result.candidates ?? []).slice(0, 3),
                vectorError: result.vectorError ?? null,
                vectorStrategy: result.vectorStrategy ?? null,
                vectorModelTag: result.vectorModelTag ?? null,
                vectorCandidateCount: result.vectorCandidateCount ?? null,
                streamTimings: {
                  rewriteMs: rewrite.rewriteMs,
                  retrievalMs,
                  ruleMs: result.timings?.ruleMs ?? null,
                  embeddingMs: result.timings?.embeddingMs ?? null,
                  vectorMs: result.timings?.vectorMs ?? null,
                  rerankMs: result.timings?.rerankMs ?? null,
                  llmFirstTokenMs: null,
                  llmStreamMs: null,
                  persistenceMs,
                  totalMs: Date.now() - requestStartedAt,
                }
              }
            });
            persistenceMs += Date.now() - persistenceStartedAt;
          } catch (error) {
            request.log.warn(error, "failed to persist no-match assistant turn before /chat/stream response");
          }
        }

        return reply.code(200).send({
          conversationId: persistenceContext?.conversationId ?? null,
          userMessageId: persistenceContext?.userMessageId ?? null,
          assistantMessageId: persistenceContext?.assistantMessageId ?? null,
          error: "NO_MATCH",
          confidence: result.confidence,
          hasCandidates,
          message: noMatchMessage
        });
      }

      // Set headers for Server-Sent Events
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });

      // metadata를 먼저 전송해 프론트에서 링크와 상태를 즉시 표시할 수 있게 함
      const similarIssueUrl = hasManualMatch
        ? selectedManualCandidate.linkUrl
        : hasManualClarification
        ? null
        : result.bestRequireId
        ? `${COVISION_SERVICE_VIEW_BASE_URL}?req_id=${result.bestRequireId}&system=Menu01&alias=Menu01.Service.List&mnid=705`
        : null;
      // Top3 후보를 카드 표시용으로 정제 (previewText 100자 기준)
      const top3Candidates = hasManualMatch || hasManualClarification
        ? []
        : result.candidates.slice(0, 3).map((c) => ({
            requireId: c.requireId,
            sccId: c.sccId,
            score: c.score,
            chunkType: c.chunkType,
            previewText: (c.issuePreview ?? c.qaPairPreview ?? c.previewText ?? "").slice(0, 100),
            linkUrl: buildSimilarIssueUrl(c.requireId),
          }));
      const streamAnswerSource = hasManualMatch ? "manual" : hasManualClarification ? "clarification" : "llm_stream";
      const streamAnswerText = hasManualMatch
        ? buildManualAnswer(selectedManualCandidate) ?? ""
        : hasManualClarification
          ? result.bestAnswerText ?? ""
          : "";

      const metadata: Record<string, unknown> & { streamTimings: StreamTimingMetadata } = {
        logId: logUuid,
        conversationId: persistenceContext?.conversationId ?? null,
        userMessageId: persistenceContext?.userMessageId ?? null,
        assistantMessageId: persistenceContext?.assistantMessageId ?? null,
        bestRequireId: result.bestRequireId,
        bestSccId: result.bestSccId,
        confidence: result.confidence,
        answerSource: streamAnswerSource,
        retrievalMode: result.retrievalMode,
        similarIssueUrl,
        linkLabel: similarIssueUrl ? (hasManualMatch ? "사용자 매뉴얼 열기" : "유사 이력 바로가기") : null,
        top3Candidates,
        manualCandidates: result.manualCandidates ?? [],
        manualCandidateCount: result.manualCandidateCount ?? 0,
        queryRewritten: rewrite.rewriteUsed,
        rewrittenQuery: rewrite.rewriteUsed ? effectiveQuery : null,
        vectorError: result.vectorError ?? null,
        vectorStrategy: result.vectorStrategy ?? null,
        vectorModelTag: result.vectorModelTag ?? null,
        vectorCandidateCount: result.vectorCandidateCount ?? null,
        streamTimings: {
          rewriteMs: rewrite.rewriteMs,
          retrievalMs,
          ruleMs: result.timings?.ruleMs ?? null,
          embeddingMs: result.timings?.embeddingMs ?? null,
          vectorMs: result.timings?.vectorMs ?? null,
          rerankMs: result.timings?.rerankMs ?? null,
          llmFirstTokenMs: null,
          llmStreamMs: null,
          persistenceMs,
          totalMs: null,
        },
        display: buildDisplayPayload({
          answerText: streamAnswerText,
          requireId: hasManualMatch || hasManualClarification ? null : result.bestRequireId,
          sccId: hasManualMatch || hasManualClarification ? null : result.bestSccId,
          linkUrl: similarIssueUrl,
          confidence: result.confidence,
          answerSource: hasManualMatch ? "manual" : hasManualClarification ? "clarification" : "llm",
          retrievalMode: result.retrievalMode
        })
      };
      reply.raw.write(`data: ${JSON.stringify({ type: "metadata", data: metadata })}\n\n`);

      // Stream the answer
      let chunkCount = 0;
      let accumulatedText = "";
      let llmFirstTokenMs: number | null = null;
      const llmStartedAt = Date.now();
      if (hasManualMatch || hasManualClarification) {
        accumulatedText = streamAnswerText;
        chunkCount = accumulatedText.length > 0 ? 1 : 0;
        llmFirstTokenMs = 0;
        if (accumulatedText.length > 0) {
          reply.raw.write(`data: ${JSON.stringify({ type: "chunk", data: accumulatedText })}\n\n`);
        }
      } else {
        for await (const chunk of generateChatAnswerStream(effectiveQuery, result, conversationHistory)) {
          chunkCount++;
          accumulatedText += chunk;
          llmFirstTokenMs ??= Date.now() - llmStartedAt;
          const timestamp = Date.now();
          request.log.info({ chunkCount, timestamp, chunkLength: chunk.length }, "Sending chunk");
          reply.raw.write(`data: ${JSON.stringify({ type: "chunk", data: chunk })}\n\n`);
        }
      }
      const llmStreamMs = hasManualMatch || hasManualClarification ? 0 : Date.now() - llmStartedAt;
      metadata.streamTimings = {
        ...metadata.streamTimings,
        llmFirstTokenMs,
        llmStreamMs,
        persistenceMs,
        totalMs: Date.now() - requestStartedAt,
      };

      // Send done signal
      request.log.info({ totalChunks: chunkCount, streamTimings: metadata.streamTimings }, "Stream completed");

      // 스트림 완료 후 결과를 캐시에 저장 (LLM 응답이 있을 때만)
      if (accumulatedText.length > 0) {
        setCachedResult(query, scope, {
          metadata,
          fullText: accumulatedText,
          cachedAt: Date.now(),
        });
      }

      logQuery({
        logUuid,
        query,
        retrievalScope: scope,
        confidence: result.confidence,
        bestRequireId: result.bestRequireId,
        bestSccId: result.bestSccId,
        chunkType: result.bestChunkType,
        vectorUsed: result.vectorUsed,
        retrievalMode: result.retrievalMode,
        answerSource: streamAnswerSource,
        llmUsed: !hasManualMatch && !hasManualClarification,
        llmSkipped: hasManualMatch || hasManualClarification,
        llmSkipReason: hasManualMatch ? "MANUAL_CANDIDATE" : hasManualClarification ? "MANUAL_CLARIFICATION" : undefined,
        isNoMatch: false,
        ruleMs: result.timings?.ruleMs,
        embeddingMs: result.timings?.embeddingMs,
        vectorMs: result.timings?.vectorMs,
        rerankMs: result.timings?.rerankMs,
        retrievalMs,
        llmMs: llmStreamMs,
        totalMs: Date.now() - requestStartedAt,
      });

      if (persistenceContext) {
        try {
          const persistenceStartedAt = Date.now();
          await finishConversationPersistence({
            context: persistenceContext,
            content: accumulatedText,
            status: streamAnswerSource,
            answerSource: streamAnswerSource,
            retrievalMode: result.retrievalMode,
            confidence: result.confidence,
            bestRequireId: hasManualMatch || hasManualClarification ? null : result.bestRequireId,
            bestSccId: hasManualMatch || hasManualClarification ? null : result.bestSccId,
            similarIssueUrl,
            logUuid,
            metadata
          });
          persistenceMs += Date.now() - persistenceStartedAt;
          metadata.streamTimings = {
            ...metadata.streamTimings,
            persistenceMs,
            totalMs: Date.now() - requestStartedAt,
          };
        } catch (error) {
          request.log.warn(error, "failed to persist conversation assistant turn before /chat/stream done");
        }
      }

      reply.raw.write(`data: ${JSON.stringify({ type: "done", data: {
        conversationId: persistenceContext?.conversationId ?? null,
        userMessageId: persistenceContext?.userMessageId ?? null,
        assistantMessageId: persistenceContext?.assistantMessageId ?? null,
        streamTimings: metadata.streamTimings
      } })}\n\n`);
      reply.raw.end();
    } catch (error) {
      request.log.error(error, "failed to run /chat/stream");
      if (!reply.raw.headersSent) {
        return reply.code(500).send({
          error: "CHAT_STREAM_FAILED",
          message: "Failed to stream answer."
        });
      }
    }
  });

  // 사용자 피드백 저장 API
  app.post<{ Body: { logId: string; feedback: "up" | "down" } }>("/feedback", async (request, reply) => {
    const { logId, feedback } = request.body ?? {};
    if (!logId || !["up", "down"].includes(feedback)) {
      return reply.code(400).send({ error: "INVALID_PAYLOAD", message: "`logId` and `feedback` (up|down) are required." });
    }
    const pool = getVectorPool();
    try {
      const result = await pool.query(
        `update ai_core.query_log set user_feedback = $1 where log_uuid = $2`,
        [feedback, logId]
      );
      if (result.rowCount === 0) {
        return reply.code(404).send({ error: "NOT_FOUND", message: "No log entry found for the given logId." });
      }
      return reply.code(200).send({ ok: true });
    } catch (error) {
      request.log.error(error, "failed to save feedback");
      return reply.code(500).send({ error: "FEEDBACK_FAILED", message: "Failed to save feedback." });
    }
  });

  app.post<{ Body: RetrievalDebugRequestBody }>("/retrieval/search", async (request, reply) => {
    const query = request.body?.query?.trim();
    const scopeRaw = request.body?.retrievalScope?.trim().toLowerCase();
    const scopeDefault = (process.env.RETRIEVAL_SCOPE_DEFAULT ?? "all").toLowerCase();
    const scope = (scopeRaw ?? scopeDefault) as RetrievalScope;

    if (!query) {
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: "`query` is required."
      });
    }

    if (query.length < 2) {
      return reply.code(400).send({
        error: "QUERY_TOO_SHORT",
        message: "`query` must be at least 2 characters."
      });
    }

    if (!["all", "manual", "scc"].includes(scope)) {
      return reply.code(400).send({
        error: "INVALID_SCOPE",
        message: "`retrievalScope` must be one of all|manual|scc."
      });
    }

    try {
      const conversationHistory = sanitizeHistory(request.body?.conversationHistory);
      const rewrite = await rewriteQueryForRetrieval(query, conversationHistory);
      const effectiveQuery = rewrite.rewrittenQuery;
      const result = await runChatSearchDebug(effectiveQuery, scope, conversationHistory);
      return reply.code(200).send({
        ...result,
        query: effectiveQuery,
        originalQuery: rewrite.rewriteUsed ? query : undefined,
        queryRewritten: rewrite.rewriteUsed,
      });
    } catch (error) {
      request.log.error(error, "failed to run /retrieval/search");
      return reply.code(500).send({
        error: "RETRIEVAL_DEBUG_FAILED",
        message: "Failed to run retrieval debug search."
      });
    }
  });

  // 쿼리 로그 대시보드 API
  app.get("/admin/logs", async (request, reply) => {
    const qs = request.query as Record<string, string>;
    const limit = Math.min(Math.max(parseInt(qs.limit ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(qs.offset ?? "0", 10) || 0, 0);
    const filter = qs.filter ?? "all";
    const q = qs.q?.trim() ?? "";
    const days = Math.min(Math.max(parseInt(qs.days ?? "7", 10) || 7, 1), 90);
    const allowedFilters = new Set([
      "all",
      "failure",
      "no_match",
      "low_confidence",
      "feedback_down",
      "feedback_up",
      "slow",
      "hybrid",
      "rule_only",
    ]);
    const activeFilter = allowedFilters.has(filter) ? filter : "all";

    const baseConditions: string[] = [];
    const baseParams: unknown[] = [];
    if (days > 0) {
      baseParams.push(days);
      baseConditions.push(`created_at >= now() - ($${baseParams.length}::int * interval '1 day')`);
    }
    if (q) {
      baseParams.push(`%${q}%`);
      baseConditions.push(`query ilike $${baseParams.length}`);
    }

    const filterCondition =
      activeFilter === "failure"        ? "is_failure = true" :
      activeFilter === "no_match"       ? "is_no_match = true" :
      activeFilter === "low_confidence" ? "confidence < 0.45 and is_no_match = false" :
      activeFilter === "feedback_down"  ? "user_feedback = 'down'" :
      activeFilter === "feedback_up"    ? "user_feedback = 'up'" :
      activeFilter === "slow"           ? "coalesce(total_ms, retrieval_ms, 0) >= 5000" :
      activeFilter === "hybrid"         ? "retrieval_mode = 'hybrid'" :
      activeFilter === "rule_only"      ? "retrieval_mode = 'rule_only'" :
      "";

    const rowConditions = [...baseConditions];
    if (filterCondition) rowConditions.push(filterCondition);
    const feedbackConditions = [...baseConditions, "user_feedback is not null"];
    const downFeedbackConditions = [...baseConditions, "user_feedback = 'down'"];
    const baseWhereClause = baseConditions.length > 0 ? `where ${baseConditions.join(" and ")}` : "";
    const rowWhereClause = rowConditions.length > 0 ? `where ${rowConditions.join(" and ")}` : "";
    const feedbackWhereClause = `where ${feedbackConditions.join(" and ")}`;
    const downFeedbackWhereClause = `where ${downFeedbackConditions.join(" and ")}`;

    const pool = getVectorPool();
    try {
      const rowParams = [...baseParams, limit, offset];
      const [rowsResult, countResult, summaryResult, feedbackBreakdownResult, feedbackTopQueriesResult, embeddingCoverage] = await Promise.all([
        pool.query(
          `select q.log_uuid, q.query, q.retrieval_scope, q.confidence, q.best_require_id, q.best_scc_id,
                  q.chunk_type, q.vector_used, q.retrieval_mode, q.answer_source,
                  q.llm_used, q.llm_skipped, q.llm_skip_reason,
                  q.is_no_match, q.is_failure, q.failure_reason,
                  q.rule_ms, q.embedding_ms, q.vector_ms, q.rerank_ms, q.retrieval_ms, q.llm_ms, q.total_ms,
                  q.user_feedback, q.created_at,
                  cm.metadata as conversation_metadata,
                  cm.assistant_status,
                  left(cm.assistant_content, 2000) as assistant_content
           from (
             select *
             from ai_core.query_log
             ${rowWhereClause}
             order by created_at desc
             limit $${baseParams.length + 1} offset $${baseParams.length + 2}
           ) q
           left join lateral (
             select metadata, status as assistant_status, content as assistant_content
               from ai_core.conversation_message
              where log_uuid = q.log_uuid
                and role = 'assistant'
              order by created_at desc
              limit 1
           ) cm on true
           order by q.created_at desc`,
          rowParams
        ),
        pool.query(`select count(*) as total from ai_core.query_log ${rowWhereClause}`, baseParams),
        pool.query(
          `select
            count(*)::int as total,
            count(*) filter (where is_failure = true)::int as failure_count,
            count(*) filter (where is_no_match = true)::int as no_match_count,
            count(*) filter (where confidence < 0.45 and is_no_match = false)::int as low_confidence_count,
            count(*) filter (where user_feedback = 'up')::int as feedback_up_count,
            count(*) filter (where user_feedback = 'down')::int as feedback_down_count,
            count(*) filter (where user_feedback is not null)::int as feedback_total_count,
            round(
              100.0 * count(*) filter (where user_feedback = 'up')
              / nullif(count(*) filter (where user_feedback is not null), 0),
              1
            )::float as feedback_positive_rate_pct,
            round(
              100.0 * count(*) filter (where user_feedback = 'down')
              / nullif(count(*) filter (where user_feedback is not null), 0),
              1
            )::float as feedback_negative_rate_pct,
            count(*) filter (where retrieval_mode = 'hybrid')::int as hybrid_count,
            count(*) filter (where retrieval_mode = 'rule_only')::int as rule_only_count,
            count(*) filter (where coalesce(total_ms, retrieval_ms, 0) >= 5000)::int as slow_count,
            round(avg(confidence)::numeric, 4)::float as avg_confidence,
            round(avg(total_ms)::numeric, 0)::int as avg_total_ms,
            round(avg(retrieval_ms)::numeric, 0)::int as avg_retrieval_ms,
            max(created_at) as latest_at
           from ai_core.query_log
           ${baseWhereClause}`,
          baseParams
        ),
        pool.query(
          `select
              coalesce(answer_source, 'unknown') as answer_source,
              coalesce(retrieval_mode, 'unknown') as retrieval_mode,
              count(*)::int as feedback_count,
              count(*) filter (where user_feedback = 'up')::int as up_count,
              count(*) filter (where user_feedback = 'down')::int as down_count,
              round(
                100.0 * count(*) filter (where user_feedback = 'down') / nullif(count(*), 0),
                1
              )::float as down_rate_pct,
              round(avg(confidence)::numeric, 4)::float as avg_confidence,
              round(avg(total_ms)::numeric, 0)::int as avg_total_ms
             from ai_core.query_log
             ${feedbackWhereClause}
            group by coalesce(answer_source, 'unknown'), coalesce(retrieval_mode, 'unknown')
            order by down_count desc, feedback_count desc, answer_source asc
            limit 10`,
          baseParams
        ),
        pool.query(
          `select
              query,
              count(*)::int as down_count,
              max(created_at) as latest_at,
              max(log_uuid::text) as sample_log_uuid,
              max(best_require_id::text) as sample_require_id,
              max(best_scc_id)::text as sample_scc_id,
              round(avg(confidence)::numeric, 4)::float as avg_confidence,
              round(avg(total_ms)::numeric, 0)::int as avg_total_ms
             from ai_core.query_log
             ${downFeedbackWhereClause}
            group by query
            order by down_count desc, latest_at desc
            limit 8`,
          baseParams
        ),
        getEmbeddingCoverageMonitoring(),
      ]);

      return reply.code(200).send({
        total: parseInt(countResult.rows[0].total, 10),
        limit,
        offset,
        filter: activeFilter,
        q,
        days,
        summary: summaryResult.rows[0],
        feedbackBreakdown: feedbackBreakdownResult.rows,
        feedbackTopQueries: feedbackTopQueriesResult.rows,
        rateLimit: getRateLimitMonitoring(days),
        queryEmbedding: getQueryEmbeddingRuntimeStatus(),
        embeddingCoverage,
        build: getBuildInfo(),
        rows: rowsResult.rows
      });
    } catch (error) {
      request.log.error(error, "failed to query admin logs");
      return reply.code(500).send({ error: "ADMIN_LOGS_FAILED" });
    }
  });
  // 대화 이력 조회 API

  app.get("/conversations", async (request, reply) => {
    const qs = request.query as Record<string, string>;
    const clientSessionId = qs.clientSessionId?.trim() || null;
    const userKey = qs.userKey?.trim() || null;
    const search = qs.search?.trim() || null;
    const offset = Math.max(parseInt(qs.offset ?? "0", 10) || 0, 0);
    const days = Math.min(Math.max(parseInt(qs.days ?? "0", 10) || 0, 0), 365);
    const limit = Math.min(Math.max(parseInt(qs.limit ?? "20", 10) || 20, 1), 100);
    const includeMessages = (qs.includeMessages ?? "").trim().toLowerCase() === "true";
    if (!clientSessionId && !userKey) {
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: "`clientSessionId` or `userKey` is required."
      });
    }
    const pool = getVectorPool();
    try {
      const conditions: string[] = [];
      const identityConditions: string[] = [];
      const params: unknown[] = [];
      if (clientSessionId) {
        params.push(clientSessionId);
        identityConditions.push(`cs.client_session_id = $${params.length}`);
      }
      if (userKey) {
        params.push(userKey);
        identityConditions.push(`cs.user_key = $${params.length}`);
      }
      if (identityConditions.length > 0) {
        conditions.push(`(${identityConditions.join(" or ")})`);
      }
      if (days > 0) {
        params.push(days);
        conditions.push(`cs.updated_at >= now() - ($${params.length}::int * interval '1 day')`);
      }
      if (search) {
        params.push(`%${search}%`);
        const searchParam = params.length;
        conditions.push(`(
          cs.title ilike $${searchParam}
          or exists (
            select 1
              from ai_core.conversation_message cm
             where cm.session_id = cs.session_id
               and cm.content ilike $${searchParam}
          )
        )`);
      }
      params.push(limit + 1);
      const limitParam = params.length;
      params.push(offset);
      const offsetParam = params.length;
      const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      const sessionResult = await pool.query(
        `select session_id, client_session_id, user_key, title, status, message_count,
                last_message_at, created_at, updated_at
           from ai_core.conversation_session cs
           ${whereClause}
          order by cs.updated_at desc
          limit $${limitParam}
         offset $${offsetParam}`,
        params
      );
      const sessionRows = sessionResult.rows.slice(0, limit);
      const hasMore = sessionResult.rows.length > limit;

      if (!includeMessages || sessionRows.length === 0) {
        return reply.code(200).send({
          rows: sessionRows,
          pagination: {
            limit,
            offset,
            count: sessionRows.length,
            hasMore,
            nextOffset: hasMore ? offset + sessionRows.length : null
          }
        });
      }

      const sessionIds = sessionRows.map((row) => row.session_id);
      const messageResult = await pool.query(
        `select session_id, message_id, turn_index, role, content, status,
                answer_source, retrieval_mode, confidence, best_require_id, best_scc_id,
                similar_issue_url, log_uuid, metadata, created_at
           from ai_core.conversation_message
          where session_id = any($1::uuid[])
          order by session_id asc, turn_index asc, created_at asc`,
        [sessionIds]
      );

      const messageMap = new Map<string, unknown[]>();
      for (const row of messageResult.rows) {
        const items = messageMap.get(row.session_id) ?? [];
        items.push(row);
        messageMap.set(row.session_id, items);
      }

      const rows = sessionRows.map((row) => ({
        ...row,
        messages: messageMap.get(row.session_id) ?? []
      }));

      return reply.code(200).send({
        rows,
        pagination: {
          limit,
          offset,
          count: rows.length,
          hasMore,
          nextOffset: hasMore ? offset + rows.length : null
        }
      });
    } catch (error) {
      request.log.error(error, "failed to fetch conversations");
      return reply.code(500).send({ error: "CONVERSATION_LIST_FAILED" });
    }
  });

  app.get<{ Params: { sessionId: string } }>("/conversations/:sessionId/messages", async (request, reply) => {
    const sessionId = request.params?.sessionId?.trim();
    if (!sessionId) {
      return reply.code(400).send({
        error: "INVALID_SESSION_ID",
        message: "`sessionId` is required."
      });
    }
    const pool = getVectorPool();
    try {
      const result = await pool.query(
        `select message_id, session_id, turn_index, role, content, status,
                answer_source, retrieval_mode, confidence, best_require_id, best_scc_id,
                similar_issue_url, log_uuid, metadata, created_at
           from ai_core.conversation_message
          where session_id = $1
          order by turn_index asc, created_at asc`,
        [sessionId]
      );
      return reply.code(200).send({ rows: result.rows });
    } catch (error) {
      request.log.error(error, "failed to fetch conversation messages");
      return reply.code(500).send({ error: "CONVERSATION_MESSAGES_FAILED" });
    }
  });

  app.patch<{ Params: { clientSessionId: string }; Body: { title?: string } }>("/conversations/:clientSessionId", async (request, reply) => {
    const clientSessionId = request.params?.clientSessionId?.trim();
    const userKey = (request.query as Record<string, string> | undefined)?.userKey?.trim() || null;
    const title = request.body?.title?.trim() ?? "";

    if (!clientSessionId) {
      return reply.code(400).send({
        error: "INVALID_CLIENT_SESSION_ID",
        message: "`clientSessionId` is required."
      });
    }
    if (!title) {
      return reply.code(400).send({
        error: "INVALID_CONVERSATION_TITLE",
        message: "`title` is required."
      });
    }
    if (title.length > 80) {
      return reply.code(400).send({
        error: "CONVERSATION_TITLE_TOO_LONG",
        message: "`title` must be 80 characters or less."
      });
    }

    const pool = getVectorPool();
    try {
      const existing = await pool.query<{ session_id: string; user_key: string | null }>(
        `select session_id, user_key
           from ai_core.conversation_session
          where client_session_id = $1
          limit 1`,
        [clientSessionId]
      );

      if (!existing.rowCount || !existing.rows[0]?.session_id) {
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      }

      if (userKey && existing.rows[0].user_key && existing.rows[0].user_key !== userKey) {
        return reply.code(403).send({ error: "CONVERSATION_UPDATE_FORBIDDEN" });
      }

      const result = await pool.query(
        `update ai_core.conversation_session
            set title = $2
          where session_id = $1
          returning session_id, client_session_id, user_key, title, status,
                    message_count, last_message_at, created_at, updated_at`,
        [existing.rows[0].session_id, title]
      );

      return reply.code(200).send({ ok: true, row: result.rows[0] ?? null });
    } catch (error) {
      request.log.error(error, "failed to update conversation title");
      return reply.code(500).send({ error: "CONVERSATION_UPDATE_FAILED" });
    }
  });

  app.delete<{ Params: { clientSessionId: string } }>("/conversations/:clientSessionId", async (request, reply) => {
    const clientSessionId = request.params?.clientSessionId?.trim();
    const userKey = (request.query as Record<string, string> | undefined)?.userKey?.trim() || null;

    if (!clientSessionId) {
      return reply.code(400).send({
        error: "INVALID_CLIENT_SESSION_ID",
        message: "`clientSessionId` is required."
      });
    }

    const pool = getVectorPool();
    try {
      const existing = await pool.query<{ session_id: string; user_key: string | null }>(
        `select session_id, user_key
           from ai_core.conversation_session
          where client_session_id = $1
          limit 1`,
        [clientSessionId]
      );

      if (!existing.rowCount || !existing.rows[0]?.session_id) {
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      }

      if (userKey && existing.rows[0].user_key && existing.rows[0].user_key !== userKey) {
        return reply.code(403).send({ error: "CONVERSATION_DELETE_FORBIDDEN" });
      }

      await pool.query(
        `delete from ai_core.conversation_session
          where session_id = $1`,
        [existing.rows[0].session_id]
      );

      return reply.code(200).send({ ok: true, clientSessionId });
    } catch (error) {
      request.log.error(error, "failed to delete conversation");
      return reply.code(500).send({ error: "CONVERSATION_DELETE_FAILED" });
    }
  });

  // 서버 종료 시 캐시 정리와 DB 연결 해제

  app.addHook("onClose", async () => {
    stopCacheCleanupInterval();
    stopLlmCacheCleanupInterval();
    ingestScheduler.stop();
    await closeVectorPool();
  });

  return app;
}
