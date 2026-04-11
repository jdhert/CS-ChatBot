import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyCors from "@fastify/cors";
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
    return {
      status: "ok",
      service: "workspace-fastify",
      cache: getCacheStats(),
      queryEmbedding: getQueryEmbeddingRuntimeStatus(),
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
              queryRewritten: rewrite.rewriteUsed,
              rewrittenQuery: rewrite.rewriteUsed ? effectiveQuery : null
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

    // 보안 차단 키워드 검사
    if (containsBlockedKeyword(query)) {
      request.log.warn({ query }, "Blocked query due to security keywords");
      return reply.code(200).send({
        error: "SECURITY_BLOCKED",
        message: "보안 정책상 해당 질문에 대해서는 답변을 제공할 수 없습니다.\n\n보안 관련 문의는 담당자에게 직접 문의해 주시기 바랍니다."
      });
    }

    try {
      persistenceContext = await startConversationPersistence({
        clientSessionId: clientConversationId,
        userKey,
        title: buildConversationTitle(query),
        query,
        retrievalScope: scope,
      });
    } catch (error) {
      request.log.warn(error, "failed to persist conversation user turn before /chat/stream flow");
    }

    // 캐시 히트 시 저장된 스트림 결과 재생
    const cachedResult = getCachedResult(query, scope);
    if (cachedResult) {
      request.log.info({ query, scope }, "Cache hit ??replaying cached stream result");
      if (persistenceContext) {
        try {
          await finishConversationPersistence({
            context: persistenceContext,
            content: cachedResult.fullText,
            status: "llm_stream",
            answerSource: "llm_stream",
            retrievalMode: "hybrid",
            logUuid,
            metadata: {
              ...(cachedResult.metadata ?? {}),
              cacheHit: true,
            }
          });
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
      reply.raw.write(`data: ${JSON.stringify({ type: "metadata", data: { ...cachedResult.metadata, cacheHit: true } })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: "chunk", data: cachedResult.fullText })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: "done", data: {
        conversationId: persistenceContext?.conversationId ?? null,
        userMessageId: persistenceContext?.userMessageId ?? null,
        assistantMessageId: persistenceContext?.assistantMessageId ?? null
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
          ? "관련된 유사 후보는 찾았지만 정확도가 충분하지 않습니다.\n\n구체적인 증상이나 메뉴명을 포함해서 다시 질문해 주시면 더 정확한 결과를 찾을 수 있습니다."
          : "관련 처리 이력을 찾지 못했습니다.\n\n오류 메시지나 증상을 구체적으로 입력해 주세요.\n메뉴명 또는 기능명을 함께 입력하면 더 나은 결과를 찾을 수 있습니다.\n예: '전자결재 상신 버튼이 안 보여요', '급여 계산 오류 발생'";

        if (persistenceContext) {
          try {
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
                topScore
              }
            });
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
      const similarIssueUrl = result.bestRequireId
        ? `${COVISION_SERVICE_VIEW_BASE_URL}?req_id=${result.bestRequireId}&system=Menu01&alias=Menu01.Service.List&mnid=705`
        : null;
      // Top3 후보를 카드 표시용으로 정제 (previewText 100자 기준)
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
        conversationId: persistenceContext?.conversationId ?? null,
        userMessageId: persistenceContext?.userMessageId ?? null,
        assistantMessageId: persistenceContext?.assistantMessageId ?? null,
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

      if (persistenceContext) {
        try {
          await finishConversationPersistence({
            context: persistenceContext,
            content: accumulatedText,
            status: "llm_stream",
            answerSource: "llm_stream",
            retrievalMode: result.retrievalMode,
            confidence: result.confidence,
            bestRequireId: result.bestRequireId,
            bestSccId: result.bestSccId,
            similarIssueUrl,
            logUuid,
            metadata: { top3Candidates, queryRewritten: rewrite.rewriteUsed }
          });
        } catch (error) {
          request.log.warn(error, "failed to persist conversation assistant turn before /chat/stream done");
        }
      }

      reply.raw.write(`data: ${JSON.stringify({ type: "done", data: {
        conversationId: persistenceContext?.conversationId ?? null,
        userMessageId: persistenceContext?.userMessageId ?? null,
        assistantMessageId: persistenceContext?.assistantMessageId ?? null
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
      const [rowsResult, countResult, summaryResult, feedbackBreakdownResult, feedbackTopQueriesResult] = await Promise.all([
        pool.query(
          `select log_uuid, query, retrieval_scope, confidence, best_require_id, best_scc_id,
                  chunk_type, vector_used, retrieval_mode, answer_source,
                  llm_used, llm_skipped, llm_skip_reason,
                  is_no_match, is_failure, failure_reason,
                  rule_ms, embedding_ms, vector_ms, rerank_ms, retrieval_ms, llm_ms, total_ms,
                  user_feedback, created_at
           from ai_core.query_log
           ${rowWhereClause}
           order by created_at desc
           limit $${baseParams.length + 1} offset $${baseParams.length + 2}`,
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
      const sessionResult = await pool.query(
        `select session_id, client_session_id, user_key, title, status, message_count,
                last_message_at, created_at, updated_at
           from ai_core.conversation_session
           ${whereClause}
          order by updated_at desc
          limit $${params.length}`,
        params
      );

      if (!includeMessages || sessionResult.rows.length === 0) {
        return reply.code(200).send({ rows: sessionResult.rows });
      }

      const sessionIds = sessionResult.rows.map((row) => row.session_id);
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

      const rows = sessionResult.rows.map((row) => ({
        ...row,
        messages: messageMap.get(row.session_id) ?? []
      }));

      return reply.code(200).send({ rows });
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

