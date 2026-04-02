import Fastify, { type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import { renderChatTestPage } from "../modules/chat/chatTestPage.js";
import {
  runChatSearch,
  runChatSearchDebug,
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

// ─── 쿼리 로그 ────────────────────────────────────────────────────────────────
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

// ─── 대화 세션 영속화 ────────────────────────────────────────────────────────

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

function buildConversationTitle(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed;
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
  await pool.query(
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
     from next_turn`,
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

  await pool.query(
    `update ai_core.conversation_session
        set message_count = message_count + 1,
            last_message_at = now(),
            updated_at = now()
      where session_id = $1`,
    [input.sessionId]
  );

  return input.messageId;
}

// ─────────────────────────────────────────────────────────────────────────────

// fire-and-forget: 응답 속도에 영향 없도록 await 하지 않음
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
  ).catch(() => { /* 로그 실패는 무시 */ });
}
// 대화 이력 정제: 최대 4 turn, role/content 타입 검증
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
// ─────────────────────────────────────────────────────────────────────────────

// 보안 차단 키워드 목록 - 악의적 의도가 명확한 패턴만 차단
// "비밀번호 변경", "password 변경" 같은 정당한 CS 문의는 허용
const BLOCKED_SECURITY_KEYWORDS = [
  // 보안 우회/차단 관련
  "보안차단", "보안우회", "보안해제", "보안 차단", "보안 우회", "보안 해제",

  // 권한 상승 관련 (악의적 의도가 명확한 경우)
  "권한상승", "권한 상승",
  "루트권한 획득", "root권한 획득", "관리자권한 획득", "admin권한 획득",
  "sudo 우회", "권한 탈취",

  // 비밀번호/계정 정보 요청 (악의적 의도가 명확한 경우만)
  "비밀번호 알려", "패스워드 알려", "암호 알려",
  "관리자 비밀번호 알려", "admin password 알려", "root password 알려",
  "db 비밀번호", "데이터베이스 비밀번호", "database password",
  "비밀번호탈취", "비밀번호 탈취", "패스워드크랙", "패스워드 크랙",
  "password crack", "password cracking", "password stealing", "password dump",

  // 공격 기법
  "해킹", "크랙", "크래킹",
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
 * 쿼리에 보안 차단 키워드가 포함되어 있는지 검사
 */
function containsBlockedKeyword(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return BLOCKED_SECURITY_KEYWORDS.some(keyword =>
    lowerQuery.includes(keyword.toLowerCase())
  );
}

/**
 * DB 뷰의 regexp_replace(text, 's+', ' ', 'g') 버그로 인해
 * 's' 문자가 공백으로 치환된 텍스트를 표시용으로 복원합니다.
 * 검색/임베딩 파이프라인에는 적용하지 않습니다.
 */
function repairStrippedS(text: string): string {
  return text
    // SCC 도메인 식별자
    .replace(/\bBa e([Cc]onfig)\b/g, 'Base$1')
    .replace(/\bba e([Cc]onfig)\b/g, 'base$1')
    .replace(/\bPo t([Cc]enter)\b/g, 'Post$1')
    .replace(/\bSy tem(SMS)?\b/g, 'System$1')
    .replace(/\bsy tem\b/g, 'system')
    // SQL / 프로그래밍 키워드
    .replace(/\bIN ERT(\s+INTO)?\b/g, 'INSERT$1')
    .replace(/\bin ert\b/g, 'insert')
    .replace(/\bIN ERTED\b/g, 'INSERTED')
    .replace(/\bin erted\b/g, 'inserted')
    .replace(/\b elect\b/g, 'select')
    .replace(/\bSELECT\b/g, 'SELECT')
    // 공통 앱 단어
    .replace(/\b([Uu]) er([Cc]ode|[Dd]omain[Cc]ode|[Ii][Dd])?\b/g, (_, u, suffix) =>
      `${u === 'U' ? 'U' : 'u'}ser${suffix ?? ''}`)
    .replace(/\b([Ss]) torage\b/gi, 'Storage')
    .replace(/\b([Ss]) ervice(s?)\b/gi, 'Service$2')
    .replace(/\b([Ss]) e ion(s?)\b/gi, 'Session$2')
    .replace(/\b([Ss]) etting(s?)\b/gi, 'Setting$2');
}

const ANSWER_NOISE_PATTERNS: RegExp[] = [
  /\uC548\uB155\uD558\uC138\uC694[^\n]*[\n]?/gim,
  /\uB4F1\uB85D\uD558\uC2E0\s*SCC\uAC74\uC5D0\s*\uB300\uD574[^\n]*[\n]?/gim,
  /\uC544\uB798\uC640\s*\uAC19\uC774\s*\uCC98\uB9AC\s*\uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4\.?/gim,
  /\uC544\uB798\uC640\s*\uAC19\uC740\s*\uB0B4\uC6A9\uC73C\uB85C\s*\uCC98\uB9AC\s*\uC9C4\uD589\s*\uC911\uC785\uB2C8\uB2E4\.?/gim,
  /\uAC10\uC0AC\uD569\uB2C8\uB2E4[^\n]*[\n]?/gim,
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

function buildDisplayPayload(args: {
  answerText: string;
  requireId: string | null;
  sccId: string | null;
  linkUrl: string | null;
  confidence: number;
  answerSource: ChatResponseBody["answerSource"];
  retrievalMode: ChatResponseBody["retrievalMode"];
}): NonNullable<ChatResponseBody["display"]> {
  const hasMatch = args.requireId !== null;
  return {
    status: hasMatch ? "matched" : "needs_more_info",
    title: hasMatch ? "유사 처리 이력을 찾았습니다." : "추가 정보가 필요합니다.",
    answerText: args.answerText,
    linkLabel: hasMatch && args.linkUrl ? "유사 이력 바로가기" : null,
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

  // 자동 인제스트 스케줄러
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

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "workspace-fastify",
      cache: getCacheStats(),
    };
  });

  app.get("/test/chat", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderChatTestPage());
  });

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
      const rewrite = await rewriteQueryForRetrieval(query, conversationHistory);
      const effectiveQuery = rewrite.rewrittenQuery;

      const retrievalStartedAt = Date.now();
      const result = await runChatSearch(effectiveQuery, scope, conversationHistory);
      const retrievalMs = Date.now() - retrievalStartedAt;
      const hasRetrievalMatch = result.bestRequireId !== null;

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
        ? llmResultRaw.llmSelectedRequireId ?? result.bestRequireId
        : null;
      const selectedSccId =
        !hasRetrievalMatch
          ? null
          : llmResultRaw.llmSelectedSccId ??
        (selectedRequireId
          ? result.candidates.find((candidate) => candidate.requireId === selectedRequireId)?.sccId ??
            result.bestSccId
          : result.bestSccId);
      const selectedUrl = selectedRequireId ? buildSimilarIssueUrl(selectedRequireId) : null;

      const normalizedLlmAnswer =
        typeof llmResultRaw.generatedAnswer === "string" ? llmResultRaw.generatedAnswer.trim() : "";
      const llmAnswer = normalizedLlmAnswer.length > 0 ? normalizedLlmAnswer : null;
      const hasUsableLlmAnswer =
        llmResultRaw.llmUsed &&
        llmResultRaw.llmError === null &&
        llmAnswer !== null;

      const shouldForceDeterministic =
        hasRetrievalMatch &&
        result.bestAnswerText !== null &&
        result.confidence >= FALLBACK_MIN_CONFIDENCE &&
        (llmSkipped || !hasUsableLlmAnswer || (llmResultRaw.llmSelectedRequireId === null && !explanationRequired));

      const fallbackAnswer = shouldForceDeterministic ? buildDeterministicAnswer(result, selectedUrl) : null;
      const resolvedBaseAnswer = fallbackAnswer ?? llmAnswer ?? buildSafeDefaultAnswer(selectedUrl, selectedRequireId !== null);
      const finalAnswer = ensureAnswerHasSimilarLink(resolvedBaseAnswer, selectedUrl);
      const answerSource =
        fallbackAnswer !== null
          ? result.retrievalMode === "rule_only"
            ? "rule_only"
            : "deterministic_fallback"
          : hasUsableLlmAnswer
            ? "llm"
            : result.retrievalMode === "rule_only"
              ? "rule_only"
              : "deterministic_fallback";
      const answerSourceReason =
        fallbackAnswer !== null
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

      // 대화 세션 영속화 (fire-and-forget)
      const top3Candidates = (result.candidates ?? []).slice(0, 3);
      ensureConversationSession({
        clientSessionId: clientConversationId,
        userKey,
        title: buildConversationTitle(query)
      }).then(async (conversationId) => {
        const userMessageId = crypto.randomUUID();
        await appendConversationMessage({
          messageId: userMessageId,
          sessionId: conversationId,
          role: "user",
          content: query,
          status: "submitted",
          metadata: { retrievalScope: scope, clientConversationId }
        });
        await appendConversationMessage({
          messageId: crypto.randomUUID(),
          sessionId: conversationId,
          role: "assistant",
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
            queryRewritten: rewrite.rewriteUsed,
            rewrittenQuery: rewrite.rewriteUsed ? effectiveQuery : null
          }
        });
      }).catch((err) => {
        request.log.warn(err, "conversation persistence failed (non-critical)");
      });

      return reply.code(200).send({
        logId: logUuid,
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
    const logUuid = crypto.randomUUID();
    const query = request.body?.query?.trim();
    const scopeRaw = request.body?.retrievalScope?.trim().toLowerCase();
    const scopeDefault = (process.env.RETRIEVAL_SCOPE_DEFAULT ?? "all").toLowerCase();
    const scope = (scopeRaw ?? scopeDefault) as RetrievalScope;
    const conversationHistory = sanitizeHistory(request.body?.conversationHistory);

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
        message: "보안 정책상 해당 질문에 대해서는 답변할 수 없습니다.\n\n보안 관련 문의는 담당자에게 직접 문의해 주시기 바랍니다."
      });
    }

    // ─── 캐시 히트 처리 ───────────────────────────────────────────────────────
    const cachedResult = getCachedResult(query, scope);
    if (cachedResult) {
      request.log.info({ query, scope }, "Cache hit — replaying cached stream result");
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.write(`data: ${JSON.stringify({ type: "metadata", data: { ...cachedResult.metadata, cacheHit: true } })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: "chunk", data: cachedResult.fullText })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      reply.raw.end();
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    try {
      const rewrite = await rewriteQueryForRetrieval(query, conversationHistory);
      const effectiveQuery = rewrite.rewrittenQuery;

      const retrievalStartedAt = Date.now();
      const result = await runChatSearch(effectiveQuery, scope, conversationHistory);
      const retrievalMs = Date.now() - retrievalStartedAt;
      const hasRetrievalMatch = result.bestRequireId !== null;

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
          totalMs: Date.now() - (retrievalStartedAt - retrievalMs),
        });

        const noMatchMessage = hasCandidates && topScore >= 0.3
          ? "관련 유사 사례를 찾았지만 정확도가 충분하지 않습니다.\n\n더 구체적인 증상이나 메뉴명을 포함해서 다시 질문해 주시면 더 정확한 결과를 찾을 수 있습니다."
          : "관련 처리 이력을 찾지 못했습니다.\n\n• 오류 메시지나 증상을 구체적으로 입력해 주세요\n• 메뉴명 또는 기능명을 함께 입력하면 더 잘 찾을 수 있습니다\n• 예: '전자결재 상신 버튼이 안 눌려요', '급여 계산 오류 발생'";

        return reply.code(200).send({
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

      // Send metadata first — 프론트에서 링크/상태를 즉시 표시할 수 있도록 similarIssueUrl 포함
      const similarIssueUrl = result.bestRequireId
        ? `${COVISION_SERVICE_VIEW_BASE_URL}?req_id=${result.bestRequireId}&system=Menu01&alias=Menu01.Service.List&mnid=705`
        : null;
      // Top3 후보를 카드 표시용으로 정제 (previewText 80자 truncate)
      const top3Candidates = result.candidates.slice(0, 3).map((c) => ({
        requireId: c.requireId,
        sccId: c.sccId,
        score: c.score,
        chunkType: c.chunkType,
        previewText: (c.issuePreview ?? c.qaPairPreview ?? c.previewText ?? "").slice(0, 100),
        linkUrl: buildSimilarIssueUrl(c.requireId),
      }));

      const metadata = {
        logId: logUuid,
        bestRequireId: result.bestRequireId,
        bestSccId: result.bestSccId,
        confidence: result.confidence,
        answerSource: "llm_stream",
        retrievalMode: result.retrievalMode,
        similarIssueUrl,
        linkLabel: similarIssueUrl ? "유사 이력 바로가기" : null,
        top3Candidates,
        queryRewritten: rewrite.rewriteUsed,
        rewrittenQuery: rewrite.rewriteUsed ? effectiveQuery : null,
      };
      reply.raw.write(`data: ${JSON.stringify({ type: "metadata", data: metadata })}\n\n`);

      // Stream the answer
      let chunkCount = 0;
      let accumulatedText = "";
      for await (const chunk of generateChatAnswerStream(effectiveQuery, result, conversationHistory)) {
        chunkCount++;
        accumulatedText += chunk;
        const timestamp = Date.now();
        request.log.info({ chunkCount, timestamp, chunkLength: chunk.length }, "Sending chunk");
        reply.raw.write(`data: ${JSON.stringify({ type: "chunk", data: chunk })}\n\n`);
      }

      // Send done signal
      request.log.info({ totalChunks: chunkCount }, "Stream completed");

      // 스트리밍 완료 후 결과를 캐시에 저장 (LLM 응답이 있을 때만)
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
        answerSource: "llm_stream",
        llmUsed: true,
        llmSkipped: false,
        isNoMatch: false,
        ruleMs: result.timings?.ruleMs,
        embeddingMs: result.timings?.embeddingMs,
        vectorMs: result.timings?.vectorMs,
        rerankMs: result.timings?.rerankMs,
        retrievalMs,
        totalMs: Date.now() - retrievalStartedAt,
      });

      reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
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

  // ─── 사용자 피드백 ────────────────────────────────────────────────────────────
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

  // ─── 쿼리 로그 대시보드 API ──────────────────────────────────────────────────
  app.get("/admin/logs", async (request, reply) => {
    const qs = request.query as Record<string, string>;
    const limit = Math.min(Math.max(parseInt(qs.limit ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(qs.offset ?? "0", 10) || 0, 0);
    const filter = qs.filter ?? "all"; // all | failure | no_match | low_confidence

    const whereClause =
      filter === "failure"        ? "where is_failure = true" :
      filter === "no_match"       ? "where is_no_match = true" :
      filter === "low_confidence" ? "where confidence < 0.45 and is_no_match = false" :
      "";

    const pool = getVectorPool();
    try {
      const [rowsResult, countResult] = await Promise.all([
        pool.query(
          `select log_uuid, query, retrieval_scope, confidence, best_require_id, best_scc_id,
                  chunk_type, vector_used, retrieval_mode, answer_source,
                  llm_used, llm_skipped, llm_skip_reason,
                  is_no_match, is_failure, failure_reason,
                  rule_ms, embedding_ms, vector_ms, rerank_ms, retrieval_ms, llm_ms, total_ms,
                  user_feedback, created_at
           from ai_core.query_log
           ${whereClause}
           order by created_at desc
           limit $1 offset $2`,
          [limit, offset]
        ),
        pool.query(`select count(*) as total from ai_core.query_log ${whereClause}`)
      ]);

      return reply.code(200).send({
        total: parseInt(countResult.rows[0].total, 10),
        limit,
        offset,
        filter,
        rows: rowsResult.rows
      });
    } catch (error) {
      request.log.error(error, "failed to query admin logs");
      return reply.code(500).send({ error: "ADMIN_LOGS_FAILED" });
    }
  });
  // ─── 대화 이력 조회 API ───────────────────────────────────────────────────────

  app.get("/conversations", async (request, reply) => {
    const qs = request.query as Record<string, string>;
    const clientSessionId = qs.clientSessionId?.trim() || null;
    const userKey = qs.userKey?.trim() || null;
    const limit = Math.min(Math.max(parseInt(qs.limit ?? "20", 10) || 20, 1), 100);
    if (!clientSessionId && !userKey) {
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: "`clientSessionId` or `userKey` is required."
      });
    }
    const pool = getVectorPool();
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (clientSessionId) {
        params.push(clientSessionId);
        conditions.push(`client_session_id = $${params.length}`);
      }
      if (userKey) {
        params.push(userKey);
        conditions.push(`user_key = $${params.length}`);
      }
      params.push(limit);
      const whereClause = conditions.length > 0 ? `where ${conditions.join(" or ")}` : "";
      const result = await pool.query(
        `select session_id, client_session_id, user_key, title, status, message_count,
                last_message_at, created_at, updated_at
           from ai_core.conversation_session
           ${whereClause}
          order by updated_at desc
          limit $${params.length}`,
        params
      );
      return reply.code(200).send({ rows: result.rows });
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

  // ─────────────────────────────────────────────────────────────────────────────

  app.addHook("onClose", async () => {
    stopCacheCleanupInterval();
    stopLlmCacheCleanupInterval();
    ingestScheduler.stop();
    await closeVectorPool();
  });

  return app;
}
