import { getVectorPool } from "../../platform/db/vectorClient.js";
import type {
  ChatCandidate,
  ChatResponseBody,
  ChunkRow,
  RetrievalDebugCandidate,
  RetrievalDebugResponseBody,
  RetrievalTimings,
  RetrievalScope,
  VectorStrategy
} from "./chat.types.js";

const DEFAULT_SCORE_THRESHOLD = 0.45;
const COOLDOWN_RELAXED_SCORE_THRESHOLD = 0.43;
const COOLDOWN_RELAXED_MIN_LEXICAL_COVERAGE = 0.3;
const COOLDOWN_RELAXED_MIN_ANSWER_TRACK = 0.35;
const COOLDOWN_RELAXED_MIN_MARGIN = 0.12;
const MAX_CANDIDATES = 5;
const MAX_ANSWER_TEXT_LENGTH = 2000;
const CANDIDATE_PREVIEW_TEXT_LENGTH = 120;
const CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH = 100;
const DEFAULT_VECTOR_SEARCH_LIMIT = 30;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 8000;
const COVISION_SERVICE_VIEW_BASE_URL =
  "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx";
const DEFAULT_EMBEDDING_PROVIDER = "openai";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_GOOGLE_EMBEDDING_MODEL = "gemini-embedding-2-preview";
const DEFAULT_GOOGLE_OUTPUT_DIM = 768;
const DEFAULT_QUERY_EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RETRIEVAL_CACHE_TTL_MS = 30 * 1000;
const DEFAULT_EMBEDDING_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_EMBEDDING_MODEL_RESOLVE_TTL_MS = 5 * 60 * 1000;

type ChunkType = ChunkRow["chunkType"];
type EmbeddingProvider = "openai" | "google";

const TYPE_BONUS: Record<ChunkType, number> = {
  issue: 0.0,
  action: 0.02,
  qa_pair: 0.10,  // qa_pair 우선순위 강화 (0.04 → 0.10)
  resolution: 0.06
};
const RELEVANCE_TYPE_WEIGHT: Record<ChunkType, number> = {
  issue: 1.0,
  qa_pair: 0.9,
  resolution: 0.35,
  action: 0.25
};

const ANSWER_CHUNK_TYPES: ChunkType[] = ["resolution", "qa_pair", "action"];
const KOREAN_PARTICLES = [
  "으로",
  "에서",
  "에게",
  "까지",
  "부터",
  "으로",
  "처럼",
  "보다",
  "에게",
  "으로",
  "으로",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "에",
  "의",
  "와",
  "과",
  "도",
  "로",
  "만",
  "나",
  "요"
];
const QUERY_STOPWORDS = new Set([
  "지금",
  "혹시",
  "이거",
  "그거",
  "해당",
  "대한",
  "문의",
  "관련",
  "있어",
  "있습니다",
  "부탁",
  "확인",
  "처리",
  "요청",
  "비슷한",
  "사례",
  "처리내역",
  "내역",
  "이력"
]);
const NON_FOCUS_TOKENS = new Set([
  "오류",
  "에러",
  "문제",
  "불가",
  "불가능",
  "실패",
  "안됨",
  "이슈",
  "처리",
  "해결",
  "방법",
  "원인",
  "로그"
]);
const DOMAIN_SYNONYM_GROUPS = [
  ["휴가신청서", "휴가신청", "연차신청", "휴가", "연차", "근태"],
  ["상신", "기안", "결재", "결재상신", "품의"],
  ["조직도", "조직", "부서", "신규부서", "조직동기화", "동기화"],
  ["미생성", "누락", "생성불가", "생성안됨", "불생성"],
  ["야간근무일정", "야간근무", "근무일정", "야간일정"],
  ["리스트", "목록", "컬럼"],
  ["일시", "날짜", "년월일", "시분초"],
  ["변경", "수정", "바꾸기", "바꾸는", "바꾸려면"],
  ["표시", "노출", "보임", "보여", "나오게"],
  ["브라우저캐시여부", "브라우저캐시", "캐시적용", "캐시"],
  ["팝업", "팝업공지", "공지팝업"],
  ["안보기", "닫기", "쿠키"],
  ["메일", "이메일", "메일발송", "발송", "메일전송", "수신", "발신"],
  ["메신저", "이음톡", "톡", "메신저발송"],
  ["메시지", "메세지", "대화"],
  ["첨부파일", "파일", "첨부"],
  ["미리보기", "뷰어", "preview"],
  ["감사함", "이관문서감사함", "이관문서"],
  ["다운로드", "내려받기", "download", "xml"],
  ["개인함", "진행함", "수신함", "완료함"],
  ["등록사유", "사유"],
  ["읽음", "안읽음", "새로고침", "원복"],
  ["message-id", "messageid", "메시지아이디", "메세지아이디"],
  ["html", "붙여넣기", "웹에디터", "에디터"],
  ["지문기록", "지문인식기", "출퇴근기록", "근태기록", "결근"],
  ["전자세금계산서", "세금계산서", "taxinvoice"],
  ["상태값", "상태", "공란", "빈값"],
  ["비밀번호", "패스워드", "password"],
  ["관리자", "superadmin"],
  ["전표승인서", "전표", "승인서"],
  ["날짜시간", "날짜", "시간", "줄바꿈", "배치"],
  ["예산품의", "지출결의서", "비용품의", "품의서"],
  ["금액표기", "금액", "표기", "포맷"],
  ["속도", "느림", "느려", "지연"]
];
const DOMAIN_CORE_TOKENS = new Set([
  "휴가신청서",
  "휴가신청",
  "근태",
  "상신",
  "조직도",
  "조직동기화",
  "야간근무",
  "근무일정",
  "리스트",
  "목록",
  "컬럼",
  "날짜",
  "일시",
  "게시판",
  "부서함",
  "수신함",
  "예고함",
  "비밀번호",
  "문서번호",
  "결재문",
  "이음톡",
  "업로드",
  "캐시",
  "브라우저캐시여부",
  "팝업",
  "메신저",
  "메시지",
  "메일",
  "이메일",
  "메일발송",
  "발송",
  "message-id",
  "첨부파일",
  "미리보기",
  "감사함",
  "다운로드",
  "xml",
  "개인함",
  "등록사유",
  "읽음",
  "지문기록",
  "결근",
  "전자세금계산서",
  "상태값",
  "공란",
  "관리자",
  "전표승인서",
  "시간",
  "html",
  "웹에디터",
  "예산품의",
  "지출결의서",
  "비용품의",
  "금액",
  "드롭박스",
  "옵션",
  "정보기기이용신청서",
  "다국어",
  "코드",
  "언어",
  "설정",
  "추가",
  "등록",
  "매핑",
  "기능",
  "적용",
  "처리",
  "변경"
]);
const OUT_OF_DOMAIN_QUERY_PATTERNS = [
  /점심|메뉴|맛집|추천/i,
  /비트코인|주식|환율|코인/i,
  /날씨|운세|사주/i
];
const SENSITIVE_QUERY_PATTERNS = [
  /(비밀번호|password).*(알려|공유|보여|가르쳐)/i,
  /(알려|공유|보여|가르쳐).*(비밀번호|password)/i,
  /(주민등록번호|주민번호|개인정보|민감정보).*(알려|공유|보여|가르쳐|줄\s*수\s*있)/i,
  /(알려|공유|보여|가르쳐|줄\s*수\s*있).*(주민등록번호|주민번호|개인정보|민감정보)/i
];
const GENERIC_REPLY_PATTERNS = [
  /안녕하세요/gi,
  /등록하신\s*scc/gi,
  /처리\s*완료/gi,
  /감사합니다/gi,
  /종결/gi,
  /내선번호/gi
];

interface QueryIntent {
  needsResolution: boolean;
  hasSymptom: boolean;
  asksStatus: boolean;
}

interface VectorCandidateRow {
  sccId: string;
  requireId: string;
  chunkType: ChunkType;
  chunkText: string;
  vectorSimilarity: number;
}

interface RawVectorRow {
  sccId: string;
  requireId: string;
  chunkType: ChunkType;
  chunkText: string;
  embeddingValues: unknown;
  embeddingNorm: number;
}

interface RequireAggregate {
  requireId: string;
  sccId: string;
  topScore: number;
  topChunkType: ChunkType;
  topText: string;
  bestAnswerScore: number;
  bestAnswerChunkType: ChunkType | null;
  bestAnswerText: string | null;
  bestAnswerSccId: string | null;
  bestIssueScore: number;
  bestIssueText: string | null;
  bestActionScore: number;
  bestActionText: string | null;
  bestResolutionScore: number;
  bestResolutionText: string | null;
  bestQaPairScore: number;
  bestQaPairText: string | null;
  hasResolution: boolean;
  hasQaPair: boolean;
  bestVectorSimilarity: number;
  bestVectorText: string | null;
  bestVectorChunkType: ChunkType | null;
  bestVectorSccId: string | null;
  bestRelevanceScore: number;
}

interface RankedRequire {
  requireId: string;
  sccId: string;
  chunkType: ChunkType;
  answerText: string;
  issueText: string | null;
  actionText: string | null;
  resolutionText: string | null;
  qaPairText: string | null;
  score: number;
  ruleScore: number;
  blendedScore: number;
  fusionRankScore: number;
  rerankBonus: number;
  relevancePenalty: number;
  strongestFocusCoverage: number;
  strongestLexicalCoverage: number;
  answerTrackScore: number;
  issueTrackScore: number;
  supportTrackScore: number;
  relevanceTrackScore: number;
  vectorScore: number;
  hasVectorSignal: boolean;
  hasResolution: boolean;
  hasQaPair: boolean;
  relevancePassed: boolean;
  relevanceReason: string | null;
}

interface SearchComputationResult {
  response: ChatResponseBody;
  debug: RetrievalDebugResponseBody;
  timingBase: Omit<RetrievalTimings, "retrievalMs" | "cacheHit" | "llmMs" | "totalMs">;
}

function isEmbeddingCooldownLike(vectorError: string | null, vectorStrategy: VectorStrategy): boolean {
  if (vectorStrategy === "query_embedding_cooldown") {
    return true;
  }

  if (!vectorError) {
    return false;
  }

  return vectorError.includes("429") || vectorError.includes("COOLDOWN");
}

function shouldPromoteCooldownBest(best: RankedRequire | undefined, runnerUp: RankedRequire | undefined, vectorResult: {
  vectorError: string | null;
  vectorStrategy: VectorStrategy;
}): boolean {
  if (!best) {
    return false;
  }

  if (!isEmbeddingCooldownLike(vectorResult.vectorError, vectorResult.vectorStrategy)) {
    return false;
  }

  if (best.chunkType !== "qa_pair") {
    return false;
  }

  if (!best.relevancePassed) {
    return false;
  }

  if (best.score < COOLDOWN_RELAXED_SCORE_THRESHOLD) {
    return false;
  }

  if (best.strongestLexicalCoverage < COOLDOWN_RELAXED_MIN_LEXICAL_COVERAGE) {
    return false;
  }

  if (best.answerTrackScore < COOLDOWN_RELAXED_MIN_ANSWER_TRACK) {
    return false;
  }

  const runnerUpScore = runnerUp?.score ?? 0;
  return best.score - runnerUpScore >= COOLDOWN_RELAXED_MIN_MARGIN;
}

interface CandidateRelevanceResult {
  passed: boolean;
  penalty: number;
  strongestFocusCoverage: number;
  strongestLexicalCoverage: number;
  reason: string | null;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const queryEmbeddingCache = new Map<string, CacheEntry<QueryEmbeddingOutcome>>();
const retrievalCache = new Map<string, CacheEntry<SearchComputationResult>>();
const queryEmbeddingCooldowns = new Map<string, number>();
const embeddingModelResolutionCache = new Map<string, CacheEntry<{ model: string; modelTag: string }>>();

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function applySearchTimings(
  result: SearchComputationResult,
  retrievalMs: number,
  cacheHit: boolean
): SearchComputationResult {
  const timings: RetrievalTimings = {
    ...result.timingBase,
    retrievalMs,
    cacheHit
  };

  return {
    timingBase: result.timingBase,
    response: {
      ...result.response,
      timings
    },
    debug: {
      ...result.debug,
      timings
    }
  };
}

function parseEnvInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number
): void {
  if (ttlMs <= 0) {
    return;
  }

  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value
  });

  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    if (typeof firstKey === "string") {
      cache.delete(firstKey);
    }
  }
}

/**
 * 만료된 캐시 항목을 정리합니다.
 * 주기적으로 호출되어 메모리 누수를 방지합니다.
 */
function cleanupExpiredCacheEntries(): void {
  const now = Date.now();
  let totalDeleted = 0;

  // queryEmbeddingCache 정리
  for (const [key, entry] of queryEmbeddingCache.entries()) {
    if (entry.expiresAt <= now) {
      queryEmbeddingCache.delete(key);
      totalDeleted++;
    }
  }

  // retrievalCache 정리
  for (const [key, entry] of retrievalCache.entries()) {
    if (entry.expiresAt <= now) {
      retrievalCache.delete(key);
      totalDeleted++;
    }
  }

  // embeddingModelResolutionCache 정리
  for (const [key, entry] of embeddingModelResolutionCache.entries()) {
    if (entry.expiresAt <= now) {
      embeddingModelResolutionCache.delete(key);
      totalDeleted++;
    }
  }

  // queryEmbeddingCooldowns 정리 (5분 이상 된 항목)
  const cooldownExpiry = now - 5 * 60 * 1000;
  for (const [key, timestamp] of queryEmbeddingCooldowns.entries()) {
    if (timestamp <= cooldownExpiry) {
      queryEmbeddingCooldowns.delete(key);
      totalDeleted++;
    }
  }

  if (totalDeleted > 0) {
    console.log(`[Cache Cleanup] Deleted ${totalDeleted} expired entries. Sizes: embedding=${queryEmbeddingCache.size}, retrieval=${retrievalCache.size}, cooldowns=${queryEmbeddingCooldowns.size}, model=${embeddingModelResolutionCache.size}`);
  }
}

let cacheCleanupInterval: NodeJS.Timeout | null = null;

/**
 * 주기적 캐시 정리를 시작합니다.
 * 기본값: 1분마다 실행
 */
export function startCacheCleanupInterval(intervalMs: number = 60_000): void {
  if (cacheCleanupInterval !== null) {
    console.log("[Cache Cleanup] Interval already running");
    return;
  }

  console.log(`[Cache Cleanup] Starting interval (every ${intervalMs}ms)`);
  cacheCleanupInterval = setInterval(() => {
    cleanupExpiredCacheEntries();
  }, intervalMs);

  // 즉시 한 번 실행
  cleanupExpiredCacheEntries();
}

/**
 * 주기적 캐시 정리를 중지합니다.
 */
export function stopCacheCleanupInterval(): void {
  if (cacheCleanupInterval !== null) {
    clearInterval(cacheCleanupInterval);
    cacheCleanupInterval = null;
    console.log("[Cache Cleanup] Interval stopped");
  }
}

function resolveEmbeddingProvider(raw: string | undefined): EmbeddingProvider {
  const normalized = (raw ?? DEFAULT_EMBEDDING_PROVIDER).trim().toLowerCase();
  if (normalized === "google") {
    return "google";
  }
  return "openai";
}

function resolveEmbeddingModel(provider: EmbeddingProvider): string {
  const envModel = process.env.EMBEDDING_MODEL?.trim();
  if (envModel) {
    return envModel;
  }

  if (provider === "google") {
    return process.env.GOOGLE_EMBEDDING_MODEL?.trim() ?? DEFAULT_GOOGLE_EMBEDDING_MODEL;
  }

  return process.env.OPENAI_EMBEDDING_MODEL?.trim() ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
}

function shouldAutoAlignEmbeddingModel(): boolean {
  const raw = process.env.EMBEDDING_MODEL_AUTO_ALIGN?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !["0", "false", "off", "no"].includes(raw);
}

function resolveEmbeddingModelTag(provider: EmbeddingProvider, model: string): string {
  return `${provider}:${model}`;
}

async function resolveActiveEmbeddingModel(
  provider: EmbeddingProvider
): Promise<{ model: string; modelTag: string }> {
  const configuredModel = resolveEmbeddingModel(provider);
  const configuredTag = resolveEmbeddingModelTag(provider, configuredModel);
  if (!shouldAutoAlignEmbeddingModel()) {
    return { model: configuredModel, modelTag: configuredTag };
  }

  const cacheKey = `${provider}::${configuredTag}`;
  const cached = getCachedValue(embeddingModelResolutionCache, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const pool = getVectorPool();
    const result = await pool.query<{
      configured_rows: string;
      dominant_model: string | null;
    }>(`
      with configured as (
        select count(*)::int as configured_rows
        from ai_core.scc_chunk_embeddings
        where embedding_model = $1
      ),
      dominant as (
        select embedding_model as dominant_model
        from ai_core.scc_chunk_embeddings
        where embedding_model like $2
        group by embedding_model
        order by count(*) desc
        limit 1
      )
      select
        (select configured_rows from configured)::text as configured_rows,
        (select dominant_model from dominant) as dominant_model
    `, [configuredTag, `${provider}:%`]);

    const row = result.rows[0];
    const configuredRows = Number.parseInt(row?.configured_rows ?? "0", 10);
    const dominantModelTag = row?.dominant_model?.trim() ?? null;
    const resolved =
      configuredRows > 0 || !dominantModelTag
        ? { model: configuredModel, modelTag: configuredTag }
        : {
            model: dominantModelTag.slice(provider.length + 1),
            modelTag: dominantModelTag
          };

    setCachedValue(
      embeddingModelResolutionCache,
      cacheKey,
      resolved,
      parseEnvInt(process.env.EMBEDDING_MODEL_RESOLVE_TTL_MS, DEFAULT_EMBEDDING_MODEL_RESOLVE_TTL_MS)
    );
    return resolved;
  } catch {
    return { model: configuredModel, modelTag: configuredTag };
  }
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

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeToken(token: string): string {
  let normalized = token.toLowerCase().trim();
  for (const particle of KOREAN_PARTICLES) {
    if (normalized.endsWith(particle) && normalized.length > particle.length + 1) {
      normalized = normalized.slice(0, -particle.length);
      break;
    }
  }

  const canonicalPatterns: Array<[RegExp, string]> = [
    [/생성해$|생성하는$|생성하려면$|생성방법$/u, "생성"],
    [/바꾸는$|바꾸기$|바꾸려면$|바꾸$/u, "변경"],
    [/보여$|보이는$|나오게$/u, "표시"],
    [/알려줘$|알려주세요$/u, "안내"],
    [/느려$|느립니다$|느린$/u, "속도"],
    [/원복돼$|원복되$|돌아가$/u, "원복"],
    [/안보여$|안\s*보여$|공란으로$/u, "공란"]
  ];
  for (const [pattern, replacement] of canonicalPatterns) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement);
      break;
    }
  }
  return normalized;
}

function tokenize(text: string): string[] {
  const rawTokens = normalizeText(text).match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const normalizedTokens = rawTokens
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 1 && !QUERY_STOPWORDS.has(token));
  return [...new Set(normalizedTokens)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalizeQueryTerms(query: string): string {
  let rewritten = normalizeText(query);
  const phraseCanonicalRules: Array<[RegExp, string]> = [
    [/야간근무\s+일정/gu, "야간근무일정"],
    [/근무\s+일정/gu, "근무일정"],
    [/메일\s+발송/gu, "메일발송"],
    [/이메일\s+발송/gu, "메일발송"],
    [/브라우저\s+캐시\s+여부/gu, "브라우저캐시여부"],
    [/message\s*-\s*id/giu, "message-id"],
    [/메시지\s*아이디/gu, "message-id"],
    [/메세지\s*아이디/gu, "message-id"],
    [/지출\s+결의서/gu, "지출결의서"],
    [/비용\s+품의/gu, "비용품의"],
    [/예산\s+품의/gu, "예산품의"]
  ];
  for (const [pattern, replacement] of phraseCanonicalRules) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  for (const group of DOMAIN_SYNONYM_GROUPS) {
    const canonical = group[0];
    for (const variant of group) {
      if (variant === canonical) {
        continue;
      }
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}_-])${escapeRegExp(variant)}(?![\\p{L}\\p{N}_-])`,
        "gu"
      );
      rewritten = rewritten.replace(pattern, canonical);
    }
  }
  return rewritten;
}

function buildQueryVariants(query: string, intent: QueryIntent): { lexical: string[]; embedding: string[] } {
  const normalized = query.replace(/\s+/g, " ").trim();
  const focusTokens = getFocusTokens(normalized).slice(0, 6);
  const canonical = canonicalizeQueryTerms(normalized);
  const canonicalFocusTokens = getFocusTokens(canonical).slice(0, 6);

  const lexical = new Set<string>();
  const embedding = new Set<string>();

  if (normalized.length > 0) {
    lexical.add(normalized);
    embedding.add(normalized);
  }

  if (canonical.length > 0 && canonical !== normalized) {
    lexical.add(canonical);
    embedding.add(canonical);
  }

  if (canonicalFocusTokens.length >= 2) {
    lexical.add(canonicalFocusTokens.join(" "));
  }

  if (focusTokens.length >= 2) {
    lexical.add(focusTokens.join(" "));
  }

  if (intent.needsResolution && focusTokens.length > 0) {
    const suffix = focusTokens.some((token) => ["코드", "설정", "추가", "구성"].includes(token))
      ? "설정 방법"
      : "해결 방법";
    lexical.add(`${focusTokens.join(" ")} ${suffix}`);
  }

  const canonicalJoined = canonicalFocusTokens.join(" ");
  if (canonicalJoined.includes("야간근무일정") && canonicalJoined.includes("생성")) {
    lexical.add("야간근무일정 생성 관리");
    lexical.add("야간근무일정 생성");
  }

  if (canonicalJoined.includes("리스트") && canonicalJoined.includes("일시") && canonicalJoined.includes("표시")) {
    lexical.add("리스트 컬럼 일시 표시 변경");
    lexical.add("리스트 일시 표시 변경");
  }

  if (canonicalJoined.includes("브라우저캐시여부")) {
    lexical.add("브라우저캐시여부 저장 불가");
    lexical.add("기초설정관리 브라우저캐시여부");
  }

  if (canonicalJoined.includes("팝업") && canonicalJoined.includes("안보기")) {
    lexical.add("팝업 안보기 기간 설정");
    lexical.add("팝업 공지 안보기 설정");
  }

  if (canonicalJoined.includes("message-id") && canonicalJoined.includes("메일")) {
    lexical.add("메일 message-id 검색");
    lexical.add("message-id 파일 검색");
  }

  if (canonicalJoined.includes("html") && canonicalJoined.includes("붙여넣기")) {
    lexical.add("HTML 붙여넣기 상신 불가");
    lexical.add("웹에디터 HTML 붙여넣기");
  }

  if (canonicalJoined.includes("읽음")) {
    lexical.add("전자결재 읽음 처리 원복");
  }

  if (canonicalJoined.includes("감사함") && canonicalJoined.includes("다운로드")) {
    lexical.add("감사함 다운로드 xml");
  }

  return {
    lexical: [...lexical].slice(0, 6),
    embedding: [...embedding].slice(0, 3)
  };
}

function countPatternHits(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    if (matched) {
      hits += matched.length;
    }
  }
  return hits;
}

function computeGenericPenalty(chunkText: string): number {
  const hits = countPatternHits(chunkText, GENERIC_REPLY_PATTERNS);
  if (hits <= 0) {
    return 0;
  }
  return Math.min(0.18, hits * 0.04);
}

function computeChunkSizeBonus(chunkText: string): number {
  const length = chunkText.length;

  // 너무 작음 (< 200자): 맥락 부족으로 패널티
  if (length < 200) {
    return -0.03;
  }

  // 적절한 크기 (300-800자): RAG에 최적, 보너스
  if (length >= 300 && length <= 800) {
    return 0.03;
  }

  // 큰 편 (800-1500자): 중립
  if (length <= 1500) {
    return 0;
  }

  // 너무 큼 (> 1500자): 노이즈 많음, 약간 패널티
  return -0.02;
}

function tokenFuzzyHit(token: string, chunkTokens: Set<string>): boolean {
  if (chunkTokens.has(token)) {
    return true;
  }

  if (token.length < 3) {
    return false;
  }

  for (const chunkToken of chunkTokens) {
    if (chunkToken.length < 3) {
      continue;
    }
    if (chunkToken.includes(token) || token.includes(chunkToken)) {
      return true;
    }
  }
  return false;
}

function computeLexicalCoverage(query: string, chunkText: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const chunkTokenSet = new Set(tokenize(chunkText));
  const hits = queryTokens.filter((token) => tokenFuzzyHit(token, chunkTokenSet)).length;
  return clamp01(hits / queryTokens.length);
}

function getFocusTokens(query: string): string[] {
  const tokens = tokenize(query).filter(
    (token) => token.length >= 2 && !NON_FOCUS_TOKENS.has(token)
  );

  if (tokens.includes("야간근무일정") || tokens.includes("근무일정")) {
    return tokens.filter((token) => token !== "일정");
  }

  if (tokens.includes("일시")) {
    return tokens.filter((token) => token !== "날짜");
  }

  return tokens;
}

function expandWithSynonyms(token: string): string[] {
  const variants = new Set<string>([token]);
  for (const group of DOMAIN_SYNONYM_GROUPS) {
    if (!group.includes(token)) {
      continue;
    }
    for (const member of group) {
      variants.add(member);
    }
  }
  return [...variants];
}

function getDomainTokens(query: string): string[] {
  return getFocusTokens(query).filter((token) => {
    if (DOMAIN_CORE_TOKENS.has(token)) {
      return true;
    }
    return DOMAIN_SYNONYM_GROUPS.some((group) => group.includes(token));
  });
}

function computeDomainCoverage(query: string, chunkText: string): number {
  const domainTokens = getDomainTokens(query);
  if (domainTokens.length === 0) {
    return 0;
  }

  const chunkTokenSet = new Set(tokenize(chunkText));
  const hits = domainTokens.filter((token) =>
    expandWithSynonyms(token).some((variant) => tokenFuzzyHit(variant, chunkTokenSet))
  ).length;
  return clamp01(hits / domainTokens.length);
}

function isSensitiveQuery(query: string): boolean {
  return SENSITIVE_QUERY_PATTERNS.some((pattern) => pattern.test(query));
}

function isLikelyOutOfDomainQuery(query: string, intent: QueryIntent): boolean {
  if (OUT_OF_DOMAIN_QUERY_PATTERNS.some((pattern) => pattern.test(query))) {
    return true;
  }

  const domainTokens = getDomainTokens(query);
  return domainTokens.length === 0 && !intent.hasSymptom && !intent.asksStatus && !intent.needsResolution;
}

function computeFocusCoverage(query: string, chunkText: string): number {
  const focusTokens = getFocusTokens(query);
  if (focusTokens.length === 0) {
    return 0;
  }

  const chunkTokenSet = new Set(tokenize(chunkText));
  const hits = focusTokens.filter((token) =>
    expandWithSynonyms(token).some((variant) => tokenFuzzyHit(variant, chunkTokenSet))
  ).length;
  return clamp01(hits / focusTokens.length);
}

function buildBigrams(tokens: string[]): string[] {
  if (tokens.length < 2) {
    return [];
  }

  const pairs: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    pairs.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return pairs;
}

function computeSemanticScore(query: string, chunkText: string): number {
  const normalizedQuery = normalizeText(query);
  const normalizedChunk = normalizeText(chunkText);

  if (normalizedQuery.length === 0 || normalizedChunk.length === 0) {
    return 0;
  }

  const phraseHit = normalizedChunk.includes(normalizedQuery) ? 1 : 0;
  const tokens = tokenize(normalizedQuery);

  if (tokens.length === 0) {
    return phraseHit;
  }

  const chunkTokenSet = new Set(tokenize(normalizedChunk));
  const tokenHits = tokens.filter((token) => tokenFuzzyHit(token, chunkTokenSet)).length;
  const tokenCoverage = tokenHits / tokens.length;

  const bigrams = buildBigrams(tokens);
  const bigramCoverage =
    bigrams.length === 0
      ? tokenCoverage
      : bigrams.filter((bigram) => normalizedChunk.includes(bigram)).length / bigrams.length;

  const lexicalCoverage = computeLexicalCoverage(normalizedQuery, normalizedChunk);
  return clamp01(0.4 * tokenCoverage + 0.2 * bigramCoverage + 0.15 * phraseHit + 0.25 * lexicalCoverage);
}

function detectQueryIntent(query: string): QueryIntent {
  const normalized = normalizeText(query);

  const resolutionKeywords = [
    "어떻게",
    "방법",
    "해결",
    "조치",
    "원인",
    "가이드",
    "설정",
    "fix",
    "workaround",
    "solution"
  ];

  const symptomKeywords = [
    "오류",
    "에러",
    "실패",
    "안됨",
    "안돼",
    "안됩니다",
    "되지 않",
    "불가",
    "문제",
    "느려",
    "지연",
    "공란",
    "백지",
    "원복",
    "중복",
    "안보",
    "누락",
    "exception",
    "error",
    "timeout",
    "fail"
  ];

  const statusKeywords = ["진행", "상태", "완료", "종결", "처리중", "언제"];

  const hasAny = (keywords: string[]): boolean => keywords.some((keyword) => normalized.includes(keyword));

  return {
    needsResolution: hasAny(resolutionKeywords),
    hasSymptom: hasAny(symptomKeywords),
    asksStatus: hasAny(statusKeywords)
  };
}

function computeIntentBonus(intent: QueryIntent, chunkType: ChunkType): number {
  let bonus = 0;

  if (intent.needsResolution) {
    if (ANSWER_CHUNK_TYPES.includes(chunkType)) {
      bonus += 0.03;
    } else {
      bonus -= 0.01;
    }
  }

  if (intent.hasSymptom && (chunkType === "issue" || chunkType === "resolution")) {
    bonus += 0.02;
  }

  if (intent.asksStatus) {
    if (chunkType === "action") {
      bonus += 0.02;
    }
    if (chunkType === "resolution") {
      bonus += 0.01;
    }
  }

  return bonus;
}

function computeResolutionStageBonus(stage: number): number {
  if (stage >= 3) {
    return 0.03;
  }
  if (stage === 2) {
    return 0.02;
  }
  if (stage === 1) {
    return 0.01;
  }
  return 0;
}

function isAnswerChunkType(chunkType: ChunkType): boolean {
  return ANSWER_CHUNK_TYPES.includes(chunkType);
}

function computeRuleChunkScore(query: string, row: ChunkRow, intent: QueryIntent): number {
  const semanticScore = computeSemanticScore(query, row.chunkText);
  const lexicalCoverage = computeLexicalCoverage(query, row.chunkText);
  const focusCoverage = computeFocusCoverage(query, row.chunkText);
  const genericPenalty = computeGenericPenalty(row.chunkText);
  const chunkSizeBonus = computeChunkSizeBonus(row.chunkText);

  const baseScore =
    0.44 * semanticScore +
    0.2 * lexicalCoverage +
    0.12 * clamp01(row.evidenceWeight) +
    0.08 * clamp01(row.stateWeight) +
    0.08 * clamp01(row.specificityScore) +
    0.06 * clamp01(row.techSignalScore) +
    0.02 * clamp01(row.textLenScore);

  const score =
    baseScore +
    0.2 * focusCoverage +
    TYPE_BONUS[row.chunkType] +
    chunkSizeBonus +
    computeResolutionStageBonus(row.resolutionStage) +
    computeIntentBonus(intent, row.chunkType) -
    0.1 * clamp01(row.closurePenaltyScore) -
    genericPenalty;

  const weakMatchPenalty = focusCoverage === 0 && semanticScore < 0.2 ? 0.15 : 0;
  return clamp01(score - weakMatchPenalty);
}

function computeRuleChunkScoreForQueries(
  queries: string[],
  row: ChunkRow,
  intent: QueryIntent
): number {
  let best = 0;
  for (const query of queries) {
    best = Math.max(best, computeRuleChunkScore(query, row, intent));
  }
  return best;
}

// FTS 결과 행 (base 테이블에서 직접 조회)
interface FtsRow {
  sccId: string;
  requireId: string;
  chunkType: string;
  chunkText: string;
}

// GIN FTS 인덱스를 사용해 쿼리와 관련된 require_id 집합을 빠르게 조회
// v_scc_chunk_preview 전체 스캔 없이 base 테이블에서 직접 검색
async function fetchFtsChunkRows(pool: ReturnType<typeof getVectorPool>, queries: string[]): Promise<FtsRow[]> {
  // 2글자 이상 토큰만 추출, 중복 제거, 최대 10개
  const tokens = [...new Set(
    queries.flatMap(q => q.split(/[\s,.\-!?;:()\[\]{}]+/).filter(t => t.length >= 2))
  )].slice(0, 10);

  if (tokens.length === 0) return [];

  // OR 조건 tsquery 생성: '토큰1' | '토큰2' | ...
  const tsQueryStr = tokens.map(t => `'${t.replace(/'/g, "''")}'`).join(" | ");

  const sql = `
    select
      r.scc_id::text       as "sccId",
      r.require_id::text   as "requireId",
      'issue'              as "chunkType",
      coalesce(r.title,'') || ' ' || coalesce(r.context,'') as "chunkText"
    from public.scc_request r
    where to_tsvector('simple', coalesce(r.title,'') || ' ' || coalesce(r.context,''))
          @@ to_tsquery('simple', $1)
      and char_length(coalesce(r.title,'') || coalesce(r.context,'')) > 10
    limit 80

    union all

    select
      rp.scc_id::text      as "sccId",
      rp.require_id::text  as "requireId",
      'resolution'         as "chunkType",
      coalesce(rp.reply,'') as "chunkText"
    from public.scc_reply rp
    where to_tsvector('simple', coalesce(rp.reply,''))
          @@ to_tsquery('simple', $1)
      and char_length(coalesce(rp.reply,'')) > 10
    limit 80
  `;

  try {
    const result = await pool.query<FtsRow>(sql, [tsQueryStr]);
    return result.rows;
  } catch {
    // FTS 실패 시 조용히 빈 배열 반환 (인덱스 미생성 환경 대비)
    return [];
  }
}

async function fetchChunkRows(scope: RetrievalScope, queries: string[]): Promise<ChunkRow[]> {
  if (scope === "manual") {
    return [];
  }

  const pool = getVectorPool();
  const baseSelect = `
    select
      scc_id::text as "sccId",
      require_id::text as "requireId",
      chunk_type as "chunkType",
      chunk_text as "chunkText",
      coalesce(state_weight, resolved_weight, 0.30)::float8 as "stateWeight",
      coalesce(resolved_weight, state_weight, 0.30)::float8 as "resolvedWeight",
      coalesce(evidence_weight, 0.20)::float8 as "evidenceWeight",
      coalesce(text_len_score, 0.20)::float8 as "textLenScore",
      coalesce(tech_signal_score, 0.10)::float8 as "techSignalScore",
      coalesce(specificity_score, 0.20)::float8 as "specificityScore",
      coalesce(closure_penalty_score, 0.0)::float8 as "closurePenaltyScore",
      coalesce(resolution_stage, 0)::int4 as "resolutionStage"
    from ai_core.v_scc_chunk_preview
    where char_length(coalesce(chunk_text, '')) > 0
      and chunk_type in ('issue', 'action', 'resolution', 'qa_pair')
  `;

  // Pass 1: LIMIT 500 + FTS 동시 실행
  const [limitResult, ftsRows] = await Promise.all([
    pool.query<ChunkRow>(`${baseSelect}\nlimit 500`),
    fetchFtsChunkRows(pool, queries),
  ]);

  // LIMIT 500에 이미 포함된 require_id 집합
  const sampledRequireIds = new Set(limitResult.rows.map(r => r.requireId));

  // FTS 결과 중 LIMIT 500에 없는 항목만 synthetic ChunkRow로 추가
  // (feature 점수는 기본값 사용 — vector-only 합성 행과 동일한 방식)
  const syntheticRows: ChunkRow[] = ftsRows
    .filter(r => !sampledRequireIds.has(r.requireId) && r.chunkText.trim().length > 0)
    .map(r => ({
      sccId: r.sccId,
      requireId: r.requireId,
      chunkType: r.chunkType as ChunkRow["chunkType"],
      chunkText: r.chunkText,
      stateWeight: 0.30,
      resolvedWeight: 0.30,
      evidenceWeight: 0.20,
      textLenScore: 0.20,
      techSignalScore: 0.10,
      specificityScore: 0.20,
      closurePenaltyScore: 0.0,
      resolutionStage: 0,
    }));

  return [...limitResult.rows, ...syntheticRows];
}

function normalizeCosineSimilarity(raw: number): number {
  return clamp01((raw + 1) / 2);
}

function vectorNorm(values: number[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function parseEmbeddingArray(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value));
    }
  }

  return [];
}

function cosineSimilarity(queryVector: number[], queryNorm: number, targetVector: number[], targetNorm: number): number {
  if (queryNorm <= 0 || targetNorm <= 0) {
    return -1;
  }

  const length = Math.min(queryVector.length, targetVector.length);
  if (length === 0) {
    return -1;
  }

  let dot = 0;
  for (let index = 0; index < length; index += 1) {
    dot += queryVector[index] * targetVector[index];
  }

  return dot / (queryNorm * targetNorm);
}

interface QueryEmbeddingResult {
  embedding: number[];
  modelTag: string;
}

interface QueryEmbeddingFetchResult {
  embedding: number[] | null;
  error: string | null;
}

interface QueryEmbeddingOutcome {
  result: QueryEmbeddingResult | null;
  error: string | null;
  modelTag: string | null;
  vectorStrategy: VectorStrategy;
}

interface VectorCandidateFetchResult {
  rows: VectorCandidateRow[];
  vectorUsed: boolean;
  retrievalMode: "hybrid" | "rule_only";
  vectorError: string | null;
  vectorStrategy: VectorStrategy;
  vectorModelTag: string | null;
  embeddingMs: number;
  vectorQueryMs: number;
}

async function fetchOpenAiQueryEmbedding(
  query: string,
  model: string
): Promise<QueryEmbeddingFetchResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { embedding: null, error: "OPENAI_API_KEY_MISSING" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    parseEnvInt(process.env.LLM_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS)
  );

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        input: query,
        model
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        embedding: null,
        error: `OPENAI_EMBEDDING_HTTP_${response.status}`
      };
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return { embedding: null, error: "OPENAI_EMBEDDING_INVALID_RESPONSE" };
    }
    return { embedding, error: null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { embedding: null, error: "OPENAI_EMBEDDING_TIMEOUT" };
    }
    return { embedding: null, error: "OPENAI_EMBEDDING_REQUEST_FAILED" };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGoogleQueryEmbedding(
  query: string,
  model: string
): Promise<QueryEmbeddingFetchResult> {
  const apiKey = process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    return { embedding: null, error: "GOOGLE_API_KEY_MISSING" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    parseEnvInt(process.env.LLM_TIMEOUT_MS, DEFAULT_EMBEDDING_TIMEOUT_MS)
  );

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:embedContent?key=${encodeURIComponent(apiKey)}`;

    const outputDim = parseEnvInt(
      process.env.GOOGLE_EMBEDDING_OUTPUT_DIM,
      DEFAULT_GOOGLE_OUTPUT_DIM
    );

    const requestBody: Record<string, unknown> = {
      model: `models/${model}`,
      content: {
        parts: [{ text: query }]
      },
      taskType: "RETRIEVAL_QUERY"
    };

    if (outputDim > 0) {
      requestBody.outputDimensionality = outputDim;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        embedding: null,
        error: `GOOGLE_EMBEDDING_HTTP_${response.status}`
      };
    }

    const payload = (await response.json()) as {
      embedding?: { values?: number[] };
      embeddings?: Array<{ values?: number[] }>;
    };

    const values = payload.embedding?.values ?? payload.embeddings?.[0]?.values;
    if (!Array.isArray(values) || values.length === 0) {
      return { embedding: null, error: "GOOGLE_EMBEDDING_INVALID_RESPONSE" };
    }
    return { embedding: values, error: null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { embedding: null, error: "GOOGLE_EMBEDDING_TIMEOUT" };
    }
    return { embedding: null, error: "GOOGLE_EMBEDDING_REQUEST_FAILED" };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchQueryEmbedding(query: string): Promise<QueryEmbeddingOutcome> {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const embeddingCacheTtlMs = parseEnvInt(
    process.env.QUERY_EMBEDDING_CACHE_TTL_MS,
    DEFAULT_QUERY_EMBEDDING_CACHE_TTL_MS
  );
  const provider = resolveEmbeddingProvider(process.env.EMBEDDING_PROVIDER);
  const { model, modelTag } = await resolveActiveEmbeddingModel(provider);
  const cacheKey = `${modelTag}::${normalizedQuery}`;
  const cached = getCachedValue(queryEmbeddingCache, cacheKey);
  if (cached) {
    return cached;
  }

  const cooldownUntil = queryEmbeddingCooldowns.get(modelTag) ?? 0;
  if (cooldownUntil > Date.now()) {
    return {
      result: null,
      error: "QUERY_EMBEDDING_COOLDOWN_ACTIVE",
      modelTag,
      vectorStrategy: "query_embedding_cooldown"
    };
  }

  const embeddingResult =
    provider === "google"
      ? await fetchGoogleQueryEmbedding(query, model)
      : await fetchOpenAiQueryEmbedding(query, model);

  if (!embeddingResult.embedding) {
    const failed = {
      result: null,
      error: embeddingResult.error ?? "QUERY_EMBEDDING_UNAVAILABLE",
      modelTag,
      vectorStrategy: "query_embedding_unavailable" as const
    };
    if ((failed.error ?? "").includes("HTTP_429")) {
      queryEmbeddingCooldowns.set(
        modelTag,
        Date.now() + parseEnvInt(process.env.EMBEDDING_FAILURE_COOLDOWN_MS, DEFAULT_EMBEDDING_FAILURE_COOLDOWN_MS)
      );
    }
    setCachedValue(queryEmbeddingCache, cacheKey, failed, Math.min(embeddingCacheTtlMs, 30_000));
    return failed;
  }

  const success = {
    result: {
      embedding: embeddingResult.embedding,
      modelTag
    },
    error: null,
    modelTag,
    vectorStrategy: "none" as const
  };
  queryEmbeddingCooldowns.delete(modelTag);
  setCachedValue(queryEmbeddingCache, cacheKey, success, embeddingCacheTtlMs);
  return success;
}

function isPgVectorSearchEnabled(): boolean {
  const raw = process.env.PGVECTOR_SEARCH_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return !["0", "false", "off", "no"].includes(raw);
}

function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

async function fetchVectorCandidatesWithPgVector(
  queryEmbedding: QueryEmbeddingResult,
  candidateLimit: number
): Promise<VectorCandidateRow[]> {
  const pool = getVectorPool();
  const dim = queryEmbedding.embedding.length;
  const sql = `
    select
      scc_id::text as "sccId",
      require_id::text as "requireId",
      chunk_type as "chunkType",
      chunk_text as "chunkText",
      (1 - ((embedding_vec::vector(${dim})) <=> $1::vector(${dim})))::float8 as "vectorSimilarity"
    from ai_core.scc_chunk_embeddings
    where embedding_model = $2
      and embedding_dim = $3
      and embedding_vec is not null
    order by (embedding_vec::vector(${dim})) <=> $1::vector(${dim})
    limit $4
  `;

  const result = await pool.query<VectorCandidateRow>(sql, [
    toPgVectorLiteral(queryEmbedding.embedding),
    queryEmbedding.modelTag,
    queryEmbedding.embedding.length,
    candidateLimit
  ]);

  return result.rows
    .filter((row) => Number.isFinite(Number(row.vectorSimilarity)))
    .map((row) => ({
      sccId: row.sccId,
      requireId: row.requireId,
      chunkType: row.chunkType,
      chunkText: row.chunkText,
      vectorSimilarity: Number(row.vectorSimilarity)
    }));
}

async function fetchVectorCandidatesByArrayScan(
  queryEmbedding: QueryEmbeddingResult,
  candidateLimit: number
): Promise<VectorCandidateRow[]> {
  const embedding = queryEmbedding.embedding;
  const queryNorm = vectorNorm(embedding);
  if (queryNorm <= 0) {
    return [];
  }

  const scanLimit = Math.max(candidateLimit * 3, 120);
  const pool = getVectorPool();
  const sql = `
    select
      scc_id::text as "sccId",
      require_id::text as "requireId",
      chunk_type as "chunkType",
      chunk_text as "chunkText",
      embedding_values as "embeddingValues",
      embedding_norm::float8 as "embeddingNorm"
    from ai_core.scc_chunk_embeddings
    where embedding_model = $1
      and embedding_dim = $2
    order by updated_at desc
    limit $3
  `;

  const result = await pool.query<RawVectorRow>(sql, [
    queryEmbedding.modelTag,
    embedding.length,
    scanLimit
  ]);

  return result.rows
    .map((row) => {
      const targetVector = parseEmbeddingArray(row.embeddingValues);
      if (targetVector.length !== embedding.length) {
        return null;
      }

      const similarity = cosineSimilarity(embedding, queryNorm, targetVector, Number(row.embeddingNorm));
      if (!Number.isFinite(similarity)) {
        return null;
      }

      return {
        sccId: row.sccId,
        requireId: row.requireId,
        chunkType: row.chunkType,
        chunkText: row.chunkText,
        vectorSimilarity: similarity
      } as VectorCandidateRow;
    })
    .filter((row): row is VectorCandidateRow => row !== null)
    .sort((left, right) => right.vectorSimilarity - left.vectorSimilarity)
    .slice(0, candidateLimit);
}

async function fetchVectorCandidatesForSingleQuery(query: string): Promise<VectorCandidateFetchResult> {
  const embeddingStartedAt = Date.now();
  const queryEmbedding = await fetchQueryEmbedding(query);
  const embeddingMs = Date.now() - embeddingStartedAt;
  if (!queryEmbedding.result) {
    return {
      rows: [],
      vectorUsed: false,
      retrievalMode: "rule_only",
      vectorError: queryEmbedding.error ?? "QUERY_EMBEDDING_UNAVAILABLE",
      vectorStrategy: queryEmbedding.vectorStrategy,
      vectorModelTag: queryEmbedding.modelTag,
      embeddingMs,
      vectorQueryMs: 0
    };
  }

  const topK = parseEnvInt(process.env.RETRIEVAL_TOP_K, MAX_CANDIDATES);
  const candidateLimit = Math.max(topK * 6, DEFAULT_VECTOR_SEARCH_LIMIT);

  if (queryEmbedding.result.embedding.length === 0) {
    return {
      rows: [],
      vectorUsed: false,
      retrievalMode: "rule_only",
      vectorError: "QUERY_EMBEDDING_ZERO_DIM",
      vectorStrategy: "query_embedding_unavailable",
      vectorModelTag: queryEmbedding.result.modelTag,
      embeddingMs,
      vectorQueryMs: 0
    };
  }

  let vectorQueryMs = 0;

  if (isPgVectorSearchEnabled()) {
    try {
      const pgvectorStartedAt = Date.now();
      const pgvectorRows = await fetchVectorCandidatesWithPgVector(queryEmbedding.result, candidateLimit);
      vectorQueryMs += Date.now() - pgvectorStartedAt;
      if (pgvectorRows.length > 0) {
        return {
          rows: pgvectorRows,
          vectorUsed: true,
          retrievalMode: "hybrid",
          vectorError: null,
          vectorStrategy: "pgvector",
          vectorModelTag: queryEmbedding.result.modelTag,
          embeddingMs,
          vectorQueryMs
        };
      }
    } catch {
      try {
        const fallbackStartedAt = Date.now();
        const fallbackRows = await fetchVectorCandidatesByArrayScan(queryEmbedding.result, candidateLimit);
        vectorQueryMs += Date.now() - fallbackStartedAt;
        if (fallbackRows.length > 0) {
          return {
            rows: fallbackRows,
            vectorUsed: true,
            retrievalMode: "hybrid",
            vectorError: "PGVECTOR_QUERY_FAILED_FALLBACK_ARRAY_SCAN",
            vectorStrategy: "array_scan",
            vectorModelTag: queryEmbedding.result.modelTag,
            embeddingMs,
            vectorQueryMs
          };
        }
      } catch {
        return {
          rows: [],
          vectorUsed: false,
          retrievalMode: "rule_only",
          vectorError: "VECTOR_DB_QUERY_FAILED",
          vectorStrategy: "pgvector",
          vectorModelTag: queryEmbedding.result.modelTag,
          embeddingMs,
          vectorQueryMs
        };
      }

      return {
        rows: [],
        vectorUsed: false,
        retrievalMode: "rule_only",
        vectorError: "PGVECTOR_QUERY_FAILED",
        vectorStrategy: "pgvector",
        vectorModelTag: queryEmbedding.result.modelTag,
        embeddingMs,
        vectorQueryMs
      };
    }
  }

  try {
    const arrayScanStartedAt = Date.now();
    const arrayRows = await fetchVectorCandidatesByArrayScan(queryEmbedding.result, candidateLimit);
    vectorQueryMs += Date.now() - arrayScanStartedAt;
    if (arrayRows.length > 0) {
      return {
        rows: arrayRows,
        vectorUsed: true,
        retrievalMode: "hybrid",
        vectorError: null,
        vectorStrategy: "array_scan",
        vectorModelTag: queryEmbedding.result.modelTag,
        embeddingMs,
        vectorQueryMs
      };
    }
  } catch {
    return {
      rows: [],
      vectorUsed: false,
      retrievalMode: "rule_only",
      vectorError: "VECTOR_DB_QUERY_FAILED",
      vectorStrategy: "array_scan",
      vectorModelTag: queryEmbedding.result.modelTag,
      embeddingMs,
      vectorQueryMs
    };
  }

  return {
    rows: [],
    vectorUsed: false,
    retrievalMode: "rule_only",
    vectorError: null,
    vectorStrategy: "none",
    vectorModelTag: queryEmbedding.result.modelTag,
    embeddingMs,
    vectorQueryMs
  };
}

function mergeVectorCandidateRows(candidateGroups: VectorCandidateRow[][], limit: number): VectorCandidateRow[] {
  const merged = new Map<string, VectorCandidateRow>();

  for (const rows of candidateGroups) {
    for (const row of rows) {
      const key = `${row.requireId}:${row.chunkType}:${row.chunkText}`;
      const current = merged.get(key);
      if (!current || row.vectorSimilarity > current.vectorSimilarity) {
        merged.set(key, row);
      }
    }
  }

  return [...merged.values()]
    .sort((left, right) => right.vectorSimilarity - left.vectorSimilarity)
    .slice(0, limit);
}

async function fetchVectorCandidates(queries: string[]): Promise<VectorCandidateFetchResult> {
  const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter((query) => query.length > 0))];
  if (uniqueQueries.length === 0) {
    return {
      rows: [],
      vectorUsed: false,
      retrievalMode: "rule_only",
      vectorError: "QUERY_VARIANTS_EMPTY",
      vectorStrategy: "none",
      vectorModelTag: null,
      embeddingMs: 0,
      vectorQueryMs: 0
    };
  }

  const settled = await Promise.allSettled(
    uniqueQueries.map((query) => fetchVectorCandidatesForSingleQuery(query))
  );
  const results: VectorCandidateFetchResult[] = settled.map((result) =>
    result.status === "fulfilled"
      ? result.value
      : {
          rows: [],
          vectorUsed: false,
          retrievalMode: "rule_only",
          vectorError: "VECTOR_QUERY_PROMISE_FAILED",
          vectorStrategy: "none",
          vectorModelTag: null,
          embeddingMs: 0,
          vectorQueryMs: 0
        }
  );

  const topK = parseEnvInt(process.env.RETRIEVAL_TOP_K, MAX_CANDIDATES);
  const candidateLimit = Math.max(topK * 6, DEFAULT_VECTOR_SEARCH_LIMIT);
  const vectorRows = mergeVectorCandidateRows(
    results.filter((result) => result.rows.length > 0).map((result) => result.rows),
    candidateLimit
  );
  const vectorUsed = results.some((result) => result.vectorUsed);
  const vectorError =
    results.find((result) => result.vectorError && result.vectorError !== null)?.vectorError ?? null;
  const vectorStrategy =
    results.find((result) => result.vectorStrategy !== "none")?.vectorStrategy ?? "none";
  const vectorModelTag =
    results.find((result) => result.vectorModelTag !== null)?.vectorModelTag ?? null;
  const embeddingMs = results.reduce((max, result) => Math.max(max, result.embeddingMs), 0);
  const vectorQueryMs = results.reduce((max, result) => Math.max(max, result.vectorQueryMs), 0);

  return {
    rows: vectorRows,
    vectorUsed,
    retrievalMode: vectorUsed ? "hybrid" : "rule_only",
    vectorError,
    vectorStrategy,
    vectorModelTag,
    embeddingMs,
    vectorQueryMs
  };
}

function createAggregateFromRuleRow(row: ChunkRow): RequireAggregate {
  return {
    requireId: row.requireId,
    sccId: row.sccId,
    topScore: -1,
    topChunkType: row.chunkType,
    topText: row.chunkText,
    bestAnswerScore: -1,
    bestAnswerChunkType: null,
    bestAnswerText: null,
    bestAnswerSccId: null,
    bestIssueScore: -1,
    bestIssueText: null,
    bestActionScore: -1,
    bestActionText: null,
    bestResolutionScore: -1,
    bestResolutionText: null,
    bestQaPairScore: -1,
    bestQaPairText: null,
    hasResolution: false,
    hasQaPair: false,
    bestVectorSimilarity: -2,
    bestVectorText: null,
    bestVectorChunkType: null,
    bestVectorSccId: null,
    bestRelevanceScore: -1
  };
}

function createAggregateFromVectorRow(row: VectorCandidateRow): RequireAggregate {
  return {
    requireId: row.requireId,
    sccId: row.sccId,
    topScore: 0,
    topChunkType: row.chunkType,
    topText: row.chunkText,
    bestAnswerScore: isAnswerChunkType(row.chunkType) ? 0 : -1,
    bestAnswerChunkType: isAnswerChunkType(row.chunkType) ? row.chunkType : null,
    bestAnswerText: isAnswerChunkType(row.chunkType) ? row.chunkText : null,
    bestAnswerSccId: isAnswerChunkType(row.chunkType) ? row.sccId : null,
    bestIssueScore: row.chunkType === "issue" ? 0 : -1,
    bestIssueText: row.chunkType === "issue" ? row.chunkText : null,
    bestActionScore: row.chunkType === "action" ? 0 : -1,
    bestActionText: row.chunkType === "action" ? row.chunkText : null,
    bestResolutionScore: row.chunkType === "resolution" ? 0 : -1,
    bestResolutionText: row.chunkType === "resolution" ? row.chunkText : null,
    bestQaPairScore: row.chunkType === "qa_pair" ? 0 : -1,
    bestQaPairText: row.chunkType === "qa_pair" ? row.chunkText : null,
    hasResolution: row.chunkType === "resolution",
    hasQaPair: row.chunkType === "qa_pair",
    bestVectorSimilarity: row.vectorSimilarity,
    bestVectorText: row.chunkText,
    bestVectorChunkType: row.chunkType,
    bestVectorSccId: row.sccId,
    bestRelevanceScore: -1
  };
}

function updateAggregateWithRuleScore(
  current: RequireAggregate,
  row: ChunkRow,
  chunkScore: number
): void {
  current.hasResolution = current.hasResolution || row.chunkType === "resolution";
  current.hasQaPair = current.hasQaPair || row.chunkType === "qa_pair";

  if (chunkScore > current.topScore) {
    current.topScore = chunkScore;
    current.topChunkType = row.chunkType;
    current.topText = row.chunkText;
    current.sccId = row.sccId;
  }

  if (row.chunkType === "issue") {
    if (chunkScore > current.bestIssueScore) {
      current.bestIssueScore = chunkScore;
      current.bestIssueText = row.chunkText;
    }
  }

  if (row.chunkType === "action") {
    if (chunkScore > current.bestActionScore) {
      current.bestActionScore = chunkScore;
      current.bestActionText = row.chunkText;
    }
  }

  if (row.chunkType === "resolution") {
    if (chunkScore > current.bestResolutionScore) {
      current.bestResolutionScore = chunkScore;
      current.bestResolutionText = row.chunkText;
    }
  }

  if (row.chunkType === "qa_pair") {
    if (chunkScore > current.bestQaPairScore) {
      current.bestQaPairScore = chunkScore;
      current.bestQaPairText = row.chunkText;
    }
  }

  if (isAnswerChunkType(row.chunkType) && chunkScore > current.bestAnswerScore) {
    current.bestAnswerScore = chunkScore;
    current.bestAnswerChunkType = row.chunkType;
    current.bestAnswerText = row.chunkText;
    current.bestAnswerSccId = row.sccId;
  }

  const relevanceScore = chunkScore * RELEVANCE_TYPE_WEIGHT[row.chunkType];
  current.bestRelevanceScore = Math.max(current.bestRelevanceScore, relevanceScore);
}

function mergeVectorCandidates(
  byRequire: Map<string, RequireAggregate>,
  vectorRows: VectorCandidateRow[]
): void {
  for (const row of vectorRows) {
    const current = byRequire.get(row.requireId) ?? createAggregateFromVectorRow(row);

    current.hasResolution = current.hasResolution || row.chunkType === "resolution";
    current.hasQaPair = current.hasQaPair || row.chunkType === "qa_pair";

    if (row.vectorSimilarity > current.bestVectorSimilarity) {
      current.bestVectorSimilarity = row.vectorSimilarity;
      current.bestVectorText = row.chunkText;
      current.bestVectorChunkType = row.chunkType;
      current.bestVectorSccId = row.sccId;
    }

    if (!current.bestAnswerText && isAnswerChunkType(row.chunkType)) {
      current.bestAnswerText = row.chunkText;
      current.bestAnswerChunkType = row.chunkType;
      current.bestAnswerSccId = row.sccId;
      current.bestAnswerScore = Math.max(current.bestAnswerScore, 0);
    }

    if (!current.bestIssueText && row.chunkType === "issue") {
      current.bestIssueText = row.chunkText;
    }
    if (!current.bestActionText && row.chunkType === "action") {
      current.bestActionText = row.chunkText;
    }
    if (!current.bestResolutionText && row.chunkType === "resolution") {
      current.bestResolutionText = row.chunkText;
    }
    if (!current.bestQaPairText && row.chunkType === "qa_pair") {
      current.bestQaPairText = row.chunkText;
    }

    byRequire.set(row.requireId, current);
  }
}

function computeHeuristicRerankBonus(query: string, intent: QueryIntent, item: RequireAggregate): number {
  const bestIssueFocus = item.bestIssueText ? computeFocusCoverage(query, item.bestIssueText) : 0;
  const bestQaFocus = item.bestQaPairText ? computeFocusCoverage(query, item.bestQaPairText) : 0;
  const bestResolutionFocus = item.bestResolutionText ? computeFocusCoverage(query, item.bestResolutionText) : 0;
  const strongestFocus = Math.max(bestIssueFocus, bestQaFocus, bestResolutionFocus);
  let bonus = 0;

  if (intent.needsResolution) {
    if (item.bestQaPairText) {
      bonus += 0.05;
    }
    if (item.bestResolutionText) {
      bonus += 0.03;
    }
  }

  if (intent.hasSymptom && item.bestIssueText) {
    bonus += 0.04;
  }

  if (strongestFocus >= 0.66) {
    bonus += 0.06;
  } else if (strongestFocus >= 0.45) {
    bonus += 0.03;
  }

  if (item.hasResolution && item.hasQaPair) {
    bonus += 0.04;
  }

  if (bestIssueFocus >= 0.4 && bestQaFocus >= 0.35) {
    bonus += 0.05;
  }

  if (item.bestResolutionText) {
    const resolutionPenalty =
      computeGenericPenalty(item.bestResolutionText) >= 0.08 && bestResolutionFocus < 0.3 ? 0.06 : 0;
    bonus -= resolutionPenalty;
  }

  return bonus;
}

function computeReciprocalRank(rank: number | undefined, k = 50): number {
  if (!rank || rank <= 0) {
    return 0;
  }
  return 1 / (k + rank);
}

function normalizeScores(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return values.map(() => 0.5);
  }

  return values.map((value) => (value - min) / (max - min));
}

function buildRankMap(items: RequireAggregate[], scoreFn: (item: RequireAggregate) => number): Map<string, number> {
  return new Map(
    [...items]
      .sort((left, right) => scoreFn(right) - scoreFn(left))
      .map((item, index) => [item.requireId, index + 1] as const)
  );
}

function computeStrongestCoverage(query: string, item: RequireAggregate): {
  strongestFocusCoverage: number;
  strongestLexicalCoverage: number;
} {
  const texts = [
    item.bestIssueText,
    item.bestQaPairText,
    item.bestResolutionText,
    item.bestActionText,
    item.bestAnswerText,
    item.topText
  ].filter((text): text is string => typeof text === "string" && text.trim().length > 0);

  let strongestFocusCoverage = 0;
  let strongestLexicalCoverage = 0;
  for (const text of texts) {
    strongestFocusCoverage = Math.max(strongestFocusCoverage, computeFocusCoverage(query, text));
    strongestLexicalCoverage = Math.max(strongestLexicalCoverage, computeLexicalCoverage(query, text));
  }

  return {
    strongestFocusCoverage,
    strongestLexicalCoverage
  };
}

function evaluateCandidateRelevance(
  query: string,
  intent: QueryIntent,
  item: RequireAggregate,
  vectorScore: number
): CandidateRelevanceResult {
  const { strongestFocusCoverage, strongestLexicalCoverage } = computeStrongestCoverage(query, item);
  const strongestDomainCoverage = Math.max(
    item.bestIssueText ? computeDomainCoverage(query, item.bestIssueText) : 0,
    item.bestQaPairText ? computeDomainCoverage(query, item.bestQaPairText) : 0,
    item.bestResolutionText ? computeDomainCoverage(query, item.bestResolutionText) : 0,
    item.bestActionText ? computeDomainCoverage(query, item.bestActionText) : 0
  );
  const focusTokens = getFocusTokens(query);
  let passed = true;
  let penalty = 0;
  let reason: string | null = null;

  if (isSensitiveQuery(query)) {
    passed = false;
    penalty += 0.5;
    reason = "SENSITIVE_QUERY";
  }

  if (isLikelyOutOfDomainQuery(query, intent)) {
    passed = false;
    penalty += 0.24;
    reason ??= "OUT_OF_DOMAIN_QUERY";
  }

  if (focusTokens.length > 0 && strongestFocusCoverage < 0.18 && strongestLexicalCoverage < 0.22 && vectorScore < 0.72) {
    passed = false;
    penalty += 0.18;
    reason = "LOW_QUERY_ALIGNMENT";
  }

  if (getDomainTokens(query).length > 0 && strongestDomainCoverage < 0.34 && vectorScore < 0.8) {
    passed = false;
    penalty += 0.16;
    reason ??= "MISSING_DOMAIN_SIGNAL";
  }

  if (intent.needsResolution && !item.bestQaPairText && !item.bestResolutionText && strongestFocusCoverage < 0.3) {
    passed = false;
    penalty += 0.08;
    reason ??= "NO_RESOLUTION_CONTEXT";
  }

  if (intent.hasSymptom && !item.bestIssueText && strongestLexicalCoverage < 0.28) {
    passed = false;
    penalty += 0.08;
    reason ??= "NO_SYMPTOM_CONTEXT";
  }

  return {
    passed,
    penalty,
    strongestFocusCoverage,
    strongestLexicalCoverage,
    reason
  };
}

function toChatCandidate(item: RankedRequire): ChatCandidate {
  return {
    requireId: item.requireId,
    sccId: item.sccId,
    score: round2(item.score),
    chunkType: item.chunkType,
    previewText: truncate(item.answerText, CANDIDATE_PREVIEW_TEXT_LENGTH),
    issuePreview: item.issueText ? truncate(item.issueText, CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH) : null,
    actionPreview: item.actionText ? truncate(item.actionText, CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH) : null,
    resolutionPreview: item.resolutionText ? truncate(item.resolutionText, CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH) : null,
    qaPairPreview: item.qaPairText ? truncate(item.qaPairText, CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH) : null
  };
}

function toRetrievalDebugCandidate(item: RankedRequire): RetrievalDebugCandidate {
  return {
    requireId: item.requireId,
    sccId: item.sccId,
    score: round2(item.score),
    ruleScore: round2(item.ruleScore),
    vectorScore: round2(item.vectorScore),
    blendedScore: round2(item.blendedScore),
    fusionRankScore: round2(item.fusionRankScore),
    rerankBonus: round2(item.rerankBonus),
    relevancePenalty: round2(item.relevancePenalty),
    strongestFocusCoverage: round2(item.strongestFocusCoverage),
    strongestLexicalCoverage: round2(item.strongestLexicalCoverage),
    answerTrackScore: round2(item.answerTrackScore),
    issueTrackScore: round2(item.issueTrackScore),
    supportTrackScore: round2(item.supportTrackScore),
    relevanceTrackScore: round2(item.relevanceTrackScore),
    chunkType: item.chunkType,
    hasVectorSignal: item.hasVectorSignal,
    hasResolution: item.hasResolution,
    hasQaPair: item.hasQaPair,
    relevancePassed: item.relevancePassed,
    relevanceReason: item.relevanceReason,
    previewText: truncate(item.answerText, CANDIDATE_PREVIEW_TEXT_LENGTH),
    issuePreview: item.issueText ? truncate(item.issueText, CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH) : null,
    actionPreview: item.actionText ? truncate(item.actionText, CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH) : null,
    resolutionPreview: item.resolutionText ? truncate(item.resolutionText, CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH) : null,
    qaPairPreview: item.qaPairText ? truncate(item.qaPairText, CANDIDATE_SUPPORT_PREVIEW_TEXT_LENGTH) : null
  };
}

async function computeChatSearch(
  query: string,
  scope: RetrievalScope
): Promise<SearchComputationResult> {
  const retrievalStartedAt = Date.now();
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const retrievalCacheKey = `${scope}::${normalizedQuery}`;
  const retrievalCacheTtlMs = parseEnvInt(
    process.env.RETRIEVAL_CACHE_TTL_MS,
    DEFAULT_RETRIEVAL_CACHE_TTL_MS
  );
  const cached = getCachedValue(retrievalCache, retrievalCacheKey);
  if (cached) {
    return applySearchTimings(cached, Date.now() - retrievalStartedAt, true);
  }

  const intent = detectQueryIntent(query);
  const queryVariants = buildQueryVariants(query, intent);
  const emptyVectorResult: VectorCandidateFetchResult = {
    rows: [],
    vectorUsed: false,
    retrievalMode: "rule_only",
    vectorError: null,
    vectorStrategy: "none",
    vectorModelTag: null,
    embeddingMs: 0,
    vectorQueryMs: 0
  };
  const [ruleFetchResult, vectorFetchResult] = await Promise.all([
    (async () => {
      const startedAt = Date.now();
      const rows = await fetchChunkRows(scope, queryVariants.lexical);
      return {
        rows,
        durationMs: Date.now() - startedAt
      };
    })(),
    (async () => {
      if (scope === "manual") {
        return {
          result: emptyVectorResult,
          durationMs: 0
        };
      }
      const startedAt = Date.now();
      const result = await fetchVectorCandidates(queryVariants.embedding);
      return {
        result,
        durationMs: Date.now() - startedAt
      };
    })()
  ]);
  const rows = ruleFetchResult.rows;
  const vectorResult = vectorFetchResult.result;

  if (rows.length === 0) {
    const timingBase = {
      ruleMs: ruleFetchResult.durationMs,
      embeddingMs: vectorResult.embeddingMs,
      vectorMs: vectorResult.vectorQueryMs,
      rerankMs: 0
    };
    const emptyResponse: ChatResponseBody = {
      bestRequireId: null,
      bestSccId: null,
      confidence: 0,
      bestChunkType: null,
      bestAnswerText: null,
      bestIssueText: null,
      bestActionText: null,
      bestResolutionText: null,
      bestQaPairText: null,
      message: "유사 처리이력을 찾지 못했습니다.",
      similarIssueUrl: null,
      candidates: [],
      vectorUsed: false,
      retrievalMode: "rule_only",
      vectorError: null,
      vectorStrategy: "none",
      vectorModelTag: null,
      vectorCandidateCount: 0,
      timings: {
        ...timingBase,
        retrievalMs: 0,
        cacheHit: false
      }
    };

    const emptyResult: SearchComputationResult = {
      response: emptyResponse,
      debug: {
        query,
        retrievalScope: scope,
        intent,
        queryVariants,
        rowCount: 0,
        requireCount: 0,
        bestRequireId: null,
        bestSccId: null,
        bestChunkType: null,
        confidence: 0,
        vectorUsed: false,
        retrievalMode: "rule_only",
        vectorError: null,
        vectorStrategy: "none",
        vectorModelTag: null,
        vectorCandidateCount: 0,
        timings: {
          ...timingBase,
          retrievalMs: 0,
          cacheHit: false
        },
        candidates: []
      },
      timingBase
    };
    setCachedValue(retrievalCache, retrievalCacheKey, emptyResult, retrievalCacheTtlMs);
    return applySearchTimings(emptyResult, Date.now() - retrievalStartedAt, false);
  }

  const byRequire = new Map<string, RequireAggregate>();
  const ruleScoringStartedAt = Date.now();

  for (const row of rows) {
    const chunkScore = computeRuleChunkScoreForQueries(queryVariants.lexical, row, intent);
    const current = byRequire.get(row.requireId) ?? createAggregateFromRuleRow(row);

    updateAggregateWithRuleScore(current, row, chunkScore);
    byRequire.set(row.requireId, current);
  }
  const ruleMs = ruleFetchResult.durationMs + (Date.now() - ruleScoringStartedAt);

  mergeVectorCandidates(byRequire, vectorResult.rows);

  // Vector 후보 중 500-row 룰 샘플에 없어 rule scoring이 안된 항목을 보완
  // 추가 DB 쿼리 없이 vector 결과에 이미 있는 chunkText로 synthetic ChunkRow를 생성해 scoring
  // (view 전체 스캔 대신 in-memory 처리로 성능 영향 없음)
  for (const vectorRow of vectorResult.rows) {
    const aggregate = byRequire.get(vectorRow.requireId);
    if (aggregate && aggregate.bestRelevanceScore < 0) {
      const syntheticRow: ChunkRow = {
        sccId: vectorRow.sccId,
        requireId: vectorRow.requireId,
        chunkType: vectorRow.chunkType,
        chunkText: vectorRow.chunkText,
        stateWeight: 0.30,
        resolvedWeight: 0.30,
        evidenceWeight: 0.20,
        textLenScore: 0.20,
        techSignalScore: 0.10,
        specificityScore: 0.20,
        closurePenaltyScore: 0.0,
        resolutionStage: 0
      };
      const chunkScore = computeRuleChunkScoreForQueries(queryVariants.lexical, syntheticRow, intent);
      updateAggregateWithRuleScore(aggregate, syntheticRow, chunkScore);
    }
  }

  const aggregates = [...byRequire.values()];
  const rerankStartedAt = Date.now();
  const lexicalRankMap = buildRankMap(aggregates, (item) => Math.max(item.bestRelevanceScore, item.topScore));
  const vectorRankMap = buildRankMap(aggregates, (item) =>
    item.bestVectorSimilarity > -2 ? normalizeCosineSimilarity(item.bestVectorSimilarity) : -1
  );

  const baseRanked = aggregates.map((item) => {
      const answerTrackScore = Math.max(
        0,
        item.bestResolutionScore,
        item.bestQaPairScore,
        item.bestActionScore
      );
      const issueTrackScore = Math.max(0, item.bestIssueScore);
      const supportTrackScore = Math.max(0, item.topScore);
      const relevanceTrackScore = Math.max(0, item.bestRelevanceScore);

      const completenessBonus = item.hasResolution && item.hasQaPair ? 0.05 : item.hasResolution ? 0.02 : 0;
      const symptomMode = intent.hasSymptom;
      const statusMode = intent.asksStatus;

      let ruleScore = 0;
      if (statusMode) {
        ruleScore = clamp01(
          0.45 * relevanceTrackScore +
            0.4 * answerTrackScore +
            0.15 * supportTrackScore +
            completenessBonus
        );
      } else if (symptomMode) {
        ruleScore = clamp01(
          0.55 * relevanceTrackScore +
            0.3 * issueTrackScore +
            0.15 * answerTrackScore +
            completenessBonus
        );
      } else {
        ruleScore = clamp01(
          0.55 * relevanceTrackScore +
            0.3 * answerTrackScore +
            0.15 * supportTrackScore +
            completenessBonus
        );
      }

      if (symptomMode && issueTrackScore < 0.18 && answerTrackScore < 0.22) {
        ruleScore = clamp01(ruleScore - 0.12);
      }

      const hasVectorSignal = item.bestVectorSimilarity > -2;
      const vectorScore = hasVectorSignal ? normalizeCosineSimilarity(item.bestVectorSimilarity) : 0;
      // bestRelevanceScore < 0 means this item was never scored by the rule engine
      // (it entered only via vector merging, not in the 500-row rule sample).
      // Treat ruleScore=0 as "unscored" rather than "poor match" and use a
      // vector-weighted formula so strong vector signals aren't buried.
      const isVectorOnly = item.bestRelevanceScore < 0;
      const blendedScore = hasVectorSignal
        ? isVectorOnly && vectorScore > 0.82
          ? clamp01(0.5 * vectorScore)
          : clamp01(0.65 * ruleScore + 0.35 * vectorScore)
        : ruleScore;
      const rerankBonus = computeHeuristicRerankBonus(query, intent, item);
      return {
        aggregate: item,
        requireId: item.requireId,
        sccId: item.bestAnswerSccId ?? item.bestVectorSccId ?? item.sccId,
        chunkType: item.bestAnswerChunkType ?? item.bestVectorChunkType ?? item.topChunkType,
        answerText: item.bestAnswerText ?? item.bestVectorText ?? item.topText,
        issueText: item.bestIssueText,
        actionText: item.bestActionText,
        resolutionText: item.bestResolutionText,
        qaPairText: item.bestQaPairText,
        score: blendedScore,
        ruleScore,
        blendedScore,
        fusionRankScore: 0,
        rerankBonus,
        relevancePenalty: 0,
        strongestFocusCoverage: 0,
        strongestLexicalCoverage: 0,
        answerTrackScore,
        issueTrackScore,
        supportTrackScore,
        relevanceTrackScore,
        vectorScore,
        hasVectorSignal,
        hasResolution: item.hasResolution,
        hasQaPair: item.hasQaPair,
        relevancePassed: true,
        relevanceReason: null
      };
    });

  const rawFusionScores = baseRanked.map((item) => {
    const lexicalRank = lexicalRankMap.get(item.requireId);
    const vectorRank = item.hasVectorSignal ? vectorRankMap.get(item.requireId) : undefined;
    return 0.7 * computeReciprocalRank(lexicalRank) + 0.3 * computeReciprocalRank(vectorRank);
  });
  const normalizedFusionScores = normalizeScores(rawFusionScores);

  const ranked: RankedRequire[] = baseRanked
    .map((item, index) => {
      const relevance = evaluateCandidateRelevance(query, intent, item.aggregate, item.vectorScore);
      const fusionRankScore = normalizedFusionScores[index] ?? 0;
      const finalScore = clamp01(
        item.blendedScore + 0.06 * fusionRankScore + item.rerankBonus - relevance.penalty
      );

      return {
        requireId: item.requireId,
        sccId: item.sccId,
        chunkType: item.chunkType,
        answerText: item.answerText,
        issueText: item.issueText,
        actionText: item.actionText,
        resolutionText: item.resolutionText,
        qaPairText: item.qaPairText,
        score: finalScore,
        ruleScore: item.ruleScore,
        blendedScore: item.blendedScore,
        fusionRankScore,
        rerankBonus: item.rerankBonus,
        relevancePenalty: relevance.penalty,
        strongestFocusCoverage: relevance.strongestFocusCoverage,
        strongestLexicalCoverage: relevance.strongestLexicalCoverage,
        answerTrackScore: item.answerTrackScore,
        issueTrackScore: item.issueTrackScore,
        supportTrackScore: item.supportTrackScore,
        relevanceTrackScore: item.relevanceTrackScore,
        vectorScore: item.vectorScore,
        hasVectorSignal: item.hasVectorSignal,
        hasResolution: item.hasResolution,
        hasQaPair: item.hasQaPair,
        relevancePassed: relevance.passed,
        relevanceReason: relevance.reason
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (b.fusionRankScore !== a.fusionRankScore) {
        return b.fusionRankScore - a.fusionRankScore;
      }

      if (b.rerankBonus !== a.rerankBonus) {
        return b.rerankBonus - a.rerankBonus;
      }

      if (b.answerTrackScore !== a.answerTrackScore) {
        return b.answerTrackScore - a.answerTrackScore;
      }

      if (b.hasVectorSignal !== a.hasVectorSignal) {
        return Number(b.hasVectorSignal) - Number(a.hasVectorSignal);
      }

      if (b.vectorScore !== a.vectorScore) {
        return b.vectorScore - a.vectorScore;
      }

      const aBundle = a.hasResolution && a.hasQaPair ? 1 : 0;
      const bBundle = b.hasResolution && b.hasQaPair ? 1 : 0;
      if (bBundle !== aBundle) {
        return bBundle - aBundle;
      }

      return a.requireId.localeCompare(b.requireId);
    });

  const best = ranked[0];
  const runnerUp = ranked[1];
  const topRequireId = best?.requireId ?? null;
  const confidence = best ? round2(best.score) : 0;
  const hasCooldownRelaxedBest = shouldPromoteCooldownBest(best, runnerUp, vectorResult);
  const hasConfidentBest = best ? round2(best.score) >= DEFAULT_SCORE_THRESHOLD || hasCooldownRelaxedBest : false;
  const rerankMs = Date.now() - rerankStartedAt;
  const timingBase = {
    ruleMs,
    embeddingMs: vectorResult.embeddingMs,
    vectorMs: vectorResult.vectorQueryMs,
    rerankMs
  };

  const candidates = ranked.slice(0, MAX_CANDIDATES);

  const computed: SearchComputationResult = {
    response: {
      bestRequireId: hasConfidentBest ? best.requireId : null,
      bestSccId: hasConfidentBest ? best.sccId : null,
      confidence,
      bestChunkType: hasConfidentBest ? best.chunkType : null,
      bestAnswerText: hasConfidentBest
        ? truncate(best.answerText, MAX_ANSWER_TEXT_LENGTH)
        : null,
      bestIssueText: hasConfidentBest && best.issueText ? truncate(best.issueText, MAX_ANSWER_TEXT_LENGTH) : null,
      bestActionText:
        hasConfidentBest && best.actionText ? truncate(best.actionText, MAX_ANSWER_TEXT_LENGTH) : null,
      bestResolutionText:
        hasConfidentBest && best.resolutionText ? truncate(best.resolutionText, MAX_ANSWER_TEXT_LENGTH) : null,
      bestQaPairText:
        hasConfidentBest && best.qaPairText ? truncate(best.qaPairText, MAX_ANSWER_TEXT_LENGTH) : null,
      message: topRequireId
        ? "해당 이슈와 비슷한 처리이력 공유해드립니다."
        : "유사 처리이력을 찾지 못했습니다.",
      similarIssueUrl: topRequireId ? buildSimilarIssueUrl(topRequireId) : null,
      candidates: candidates.map(toChatCandidate),
      vectorUsed: vectorResult.vectorUsed,
      retrievalMode: vectorResult.retrievalMode,
      vectorError: vectorResult.vectorError,
      vectorStrategy: vectorResult.vectorStrategy,
      vectorModelTag: vectorResult.vectorModelTag,
      vectorCandidateCount: vectorResult.rows.length,
      timings: {
        ...timingBase,
        retrievalMs: 0,
        cacheHit: false
      }
    },
    debug: {
      query,
      retrievalScope: scope,
      intent,
      queryVariants,
      rowCount: rows.length,
      requireCount: byRequire.size,
      bestRequireId: hasConfidentBest ? best.requireId : null,
      bestSccId: hasConfidentBest ? best.sccId : null,
      bestChunkType: hasConfidentBest ? best.chunkType : null,
      confidence,
      vectorUsed: vectorResult.vectorUsed,
      retrievalMode: vectorResult.retrievalMode,
      vectorError: vectorResult.vectorError,
      vectorStrategy: vectorResult.vectorStrategy,
      vectorModelTag: vectorResult.vectorModelTag,
      vectorCandidateCount: vectorResult.rows.length,
      timings: {
        ...timingBase,
        retrievalMs: 0,
        cacheHit: false
      },
      candidates: ranked.slice(0, Math.max(MAX_CANDIDATES * 3, 15)).map(toRetrievalDebugCandidate)
    },
    timingBase
  };
  setCachedValue(retrievalCache, retrievalCacheKey, computed, retrievalCacheTtlMs);
  return applySearchTimings(computed, Date.now() - retrievalStartedAt, false);
}

export async function runChatSearch(
  query: string,
  scope: RetrievalScope
): Promise<ChatResponseBody> {
  const { response } = await computeChatSearch(query, scope);
  return response;
}

export async function runChatSearchDebug(
  query: string,
  scope: RetrievalScope
): Promise<RetrievalDebugResponseBody> {
  const { debug } = await computeChatSearch(query, scope);
  return debug;
}
