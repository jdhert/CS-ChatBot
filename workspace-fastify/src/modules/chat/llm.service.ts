import type { ChatResponseBody } from "./chat.types.js";

interface LlmAnswerResult {
  generatedAnswer: string | null;
  llmUsed: boolean;
  llmModel: string | null;
  llmError: string | null;
  llmSelectedRequireId: string | null;
  llmSelectedSccId: string | null;
  llmReRanked: boolean;
  llmRerankUsed: boolean;
  llmRerankReason: string | null;
}

interface LlmStructuredPayload {
  selectedRequireId?: unknown;
  selectedSccId?: unknown;
  isRelevant?: unknown;
  answer?: unknown;
  reason?: unknown;
}

interface LlmSelectionResult {
  selectedRequireId: string | null;
  selectedSccId: string | null;
  isRelevant: boolean;
  reason: string | null;
  error: string | null;
}

const PROMPT_RULESET = [
  "근거 제한: 반드시 retrieval_context와 candidates에 있는 정보만 사용한다.",
  "추측 금지: 로그/설정값/원인을 확신할 수 없으면 단정하지 않는다.",
  "선택 제한: selectedRequireId는 candidates에 존재하는 require_id만 허용한다.",
  "High Confidence 우선: best_confidence가 0.7 이상이면 해당 후보를 적극 활용한다. 완벽한 일치가 아니어도 유사 사례로 충분히 도움이 된다.",
  "불일치 처리: 모든 후보가 질문과 전혀 무관할 때만 isRelevant=false로 반환한다. 조금이라도 관련성이 있으면 isRelevant=true로 선택한다.",
  "답변 형식: answer는 한국어로 작성하고, 아래 4개 라벨을 포함한다.",
  "라벨 형식: '1) 핵심 답변', '2) 적용 방법', '3) 확인 포인트', '4) 참고 링크'",
  "유사사례 적극 활용: 완전 일치가 없어도 관련 후보가 있으면 '유사사례 기반 안내'로 명시하고 구체적인 실행 단계를 제시한다.",
  "구체성 필수: NEVER say '참고 링크에서 확인하세요'. ALWAYS extract and include actual: 설정값, 코드, 파일 경로, SQL, 명령어, 절차. Empty generic answers are STRICTLY FORBIDDEN.",
  "실제 데이터 활용: best_qa_pair_text, best_resolution_text, best_action_text에 구체적인 정보(코드, 설정값, 절차)가 있으면 반드시 추출해서 답변에 포함한다.",
  "근거 우선순위: qa_pair -> resolution -> action -> issue 순으로 맥락을 해석한다. qa_pair는 질문-답변 쌍이므로 가장 유용하다.",
  "링크 규칙: selectedRequireId가 있으면 참고 링크는 해당 require_id URL을 기재한다.",
  "링크 규칙: selectedRequireId가 null이면 참고 링크는 '없음'으로 작성한다.",
  "개인정보 금지: context에 등장하는 특정 개인 이름(예: '홍길동 대리', '김OO 사원'), 회사명, 내선번호, 이메일 주소는 답변에 절대 포함하지 않는다. 답변은 현재 질문한 사용자에게 일반적인 가이드를 제공하는 방식으로 작성한다."
] as const;
const DEFAULT_LLM_TWO_STEP_MAX_CONFIDENCE = 0.55;
const DEFAULT_LLM_ANSWER_CACHE_TTL_MS = 30 * 1000;
const DEFAULT_LLM_TIMEOUT_MS = 5000;
const DEFAULT_LLM_CANDIDATE_TOP_N = 3;
const DEFAULT_LLM_SKIP_ON_HIGH_CONFIDENCE = true;
const DEFAULT_LLM_SKIP_MIN_CONFIDENCE = 0.7;
const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 256;
const PROMPT_CONTEXT_TEXT_LENGTH = 1200;
const PROMPT_SUPPORT_TEXT_LENGTH = 1200;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const llmAnswerCache = new Map<string, CacheEntry<LlmAnswerResult>>();

function parseEnvInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(raw ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
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

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  if (ttlMs <= 0) {
    return;
  }

  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value
  });

  if (cache.size > 300) {
    const firstKey = cache.keys().next().value;
    if (typeof firstKey === "string") {
      cache.delete(firstKey);
    }
  }
}

/**
 * 만료된 LLM 캐시 항목을 정리합니다.
 * 주기적으로 호출되어 메모리 누수를 방지합니다.
 */
function cleanupExpiredLlmCacheEntries(): void {
  const now = Date.now();
  let totalDeleted = 0;

  // llmAnswerCache 정리
  for (const [key, entry] of llmAnswerCache.entries()) {
    if (entry.expiresAt <= now) {
      llmAnswerCache.delete(key);
      totalDeleted++;
    }
  }

  if (totalDeleted > 0) {
    console.log(`[LLM Cache Cleanup] Deleted ${totalDeleted} expired entries. Cache size: ${llmAnswerCache.size}`);
  }
}

let llmCacheCleanupInterval: NodeJS.Timeout | null = null;

/**
 * 주기적 LLM 캐시 정리를 시작합니다.
 * 기본값: 1분마다 실행
 */
export function startLlmCacheCleanupInterval(intervalMs: number = 60_000): void {
  if (llmCacheCleanupInterval !== null) {
    console.log("[LLM Cache Cleanup] Interval already running");
    return;
  }

  console.log(`[LLM Cache Cleanup] Starting interval (every ${intervalMs}ms)`);
  llmCacheCleanupInterval = setInterval(() => {
    cleanupExpiredLlmCacheEntries();
  }, intervalMs);

  // 즉시 한 번 실행
  cleanupExpiredLlmCacheEntries();
}

/**
 * 주기적 LLM 캐시 정리를 중지합니다.
 */
export function stopLlmCacheCleanupInterval(): void {
  if (llmCacheCleanupInterval !== null) {
    clearInterval(llmCacheCleanupInterval);
    llmCacheCleanupInterval = null;
    console.log("[LLM Cache Cleanup] Interval stopped");
  }
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "null") {
    return null;
  }
  return trimmed;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") {
      return true;
    }
    if (lowered === "false") {
      return false;
    }
  }
  return null;
}

function toPromptSnippet(text: string | null | undefined, maxLength: number): string {
  if (typeof text !== "string") {
    return "none";
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return "none";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function formatCandidateContext(retrieval: ChatResponseBody): string {
  return retrieval.candidates
    .map((candidate, index) => {
      const safePreview = toPromptSnippet(candidate.previewText, 120);
      const issuePreview = toPromptSnippet(candidate.issuePreview, 90);
      const qaPairPreview = toPromptSnippet(candidate.qaPairPreview, 90);
      const resolutionPreview = toPromptSnippet(candidate.resolutionPreview, 90);
      const actionPreview = toPromptSnippet(candidate.actionPreview, 90);

      return [
        `${index + 1}. require_id=${candidate.requireId}`,
        `scc_id=${candidate.sccId}`,
        `score=${candidate.score}`,
        `chunk_type=${candidate.chunkType}`,
        `preview=${safePreview}`,
        `issue_preview=${issuePreview}`,
        `qa_pair_preview=${qaPairPreview}`,
        `resolution_preview=${resolutionPreview}`,
        `action_preview=${actionPreview}`
      ].join(", ");
    })
    .join("\n");
}

function buildSelectionPrompt(query: string, retrieval: ChatResponseBody): string {
  const topCandidates = formatCandidateContext(retrieval);
  const bestIssueText = toPromptSnippet(retrieval.bestIssueText, PROMPT_SUPPORT_TEXT_LENGTH);
  const bestQaPairText = toPromptSnippet(retrieval.bestQaPairText, PROMPT_SUPPORT_TEXT_LENGTH);
  const bestResolutionText = toPromptSnippet(retrieval.bestResolutionText, PROMPT_SUPPORT_TEXT_LENGTH);
  const bestActionText = toPromptSnippet(retrieval.bestActionText, PROMPT_SUPPORT_TEXT_LENGTH);

  return [
    "You are ranking enterprise support candidates for one user question.",
    "Select the single most relevant candidate from the provided candidates.",
    "Prefer candidates where issue/qa_pair/resolution are semantically aligned with the query.",
    "Do not invent ids. Return ONLY valid JSON.",
    "",
    `query: ${query}`,
    "",
    "retrieval_context:",
    `best_require_id=${retrieval.bestRequireId ?? "none"}`,
    `best_scc_id=${retrieval.bestSccId ?? "none"}`,
    `best_confidence=${retrieval.confidence}`,
    `best_issue_text=${bestIssueText}`,
    `best_qa_pair_text=${bestQaPairText}`,
    `best_resolution_text=${bestResolutionText}`,
    `best_action_text=${bestActionText}`,
    "",
    "candidates:",
    topCandidates || "none",
    "",
    "JSON schema:",
    "{",
    '  "selectedRequireId": "candidate require_id or null",',
    '  "selectedSccId": "candidate scc_id string or null",',
    '  "isRelevant": true,',
    '  "reason": "short Korean reason(1 sentence)"',
    "}",
    "",
    "Rules:",
    "1) selectedRequireId must be one of candidates.require_id or null.",
    "2) If no candidate is sufficiently relevant, return null and isRelevant=false.",
    "3) how-to style query can still choose a similar candidate if the operational context matches.",
    "4) Return JSON only."
  ].join("\n");
}

function buildPrompt(query: string, retrieval: ChatResponseBody): string {
  const candidateTopN = Math.min(
    Math.max(parseEnvInt(process.env.LLM_CANDIDATE_TOP_N, DEFAULT_LLM_CANDIDATE_TOP_N), 1),
    5
  );
  const topCandidates = retrieval.candidates
    .slice(0, candidateTopN)
    .map((candidate, index) => {
      const safePreview = toPromptSnippet(candidate.previewText, 120);
      const issuePreview = toPromptSnippet(candidate.issuePreview, 90);
      const qaPairPreview = toPromptSnippet(candidate.qaPairPreview, 90);
      const resolutionPreview = toPromptSnippet(candidate.resolutionPreview, 90);
      const actionPreview = toPromptSnippet(candidate.actionPreview, 90);
      return [
        `${index + 1}. require_id=${candidate.requireId}`,
        `scc_id=${candidate.sccId}`,
        `score=${candidate.score}`,
        `chunk_type=${candidate.chunkType}`,
        `preview=${safePreview}`,
        `issue_preview=${issuePreview}`,
        `qa_pair_preview=${qaPairPreview}`,
        `resolution_preview=${resolutionPreview}`,
        `action_preview=${actionPreview}`
      ].join(", ");
    })
    .join("\n");

  const bestContext = toPromptSnippet(retrieval.bestAnswerText, PROMPT_CONTEXT_TEXT_LENGTH);
  const bestIssueText = toPromptSnippet(retrieval.bestIssueText, PROMPT_SUPPORT_TEXT_LENGTH);
  const bestQaPairText = toPromptSnippet(retrieval.bestQaPairText, PROMPT_SUPPORT_TEXT_LENGTH);
  const bestResolutionText = toPromptSnippet(retrieval.bestResolutionText, PROMPT_SUPPORT_TEXT_LENGTH);
  const bestActionText = toPromptSnippet(retrieval.bestActionText, PROMPT_SUPPORT_TEXT_LENGTH);
  const retrievalMode = retrieval.retrievalMode;
  const vectorUsed = retrieval.vectorUsed;
  const vectorError = retrieval.vectorError ?? "none";

  return [
    "You are a support assistant for enterprise maintenance history data.",
    "Your task is to compare candidate cases and pick the most relevant case for the query.",
    "You must obey the RULESET strictly.",
    "Return ONLY valid JSON without markdown.",
    "",
    `query: ${query}`,
    "",
    "retrieval_context (검색 엔진이 이미 찾은 최적 후보):",
    `best_require_id=${retrieval.bestRequireId ?? "none"}`,
    `best_scc_id=${retrieval.bestSccId ?? "none"}`,
    `best_chunk_type=${retrieval.bestChunkType ?? "none"}`,
    `best_confidence=${retrieval.confidence} <- ${retrieval.confidence >= 0.7 ? "HIGH CONFIDENCE! 이 후보를 우선 활용하세요." : ""}`,
    `best_chunk_text=${bestContext}`,
    `best_issue_text=${bestIssueText}`,
    `best_qa_pair_text=${bestQaPairText}`,
    `best_resolution_text=${bestResolutionText}`,
    `best_action_text=${bestActionText}`,
    `retrieval_mode=${retrievalMode}`,
    `vector_used=${vectorUsed}`,
    `vector_error=${vectorError}`,
    "",
    "candidates (상위 후보 목록):",
    topCandidates || "none",
    "",
    "IMPORTANT: best_confidence가 0.7 이상이면 best_require_id를 selectedRequireId로 선택하고, best_qa_pair_text, best_resolution_text, best_action_text의 실제 내용을 활용해서 구체적인 답변을 작성하세요.",
    "",
    "Answer Example (답변 작성 필수 형식):",
    'query: "다국어 코드 추가하는 방법"',
    'best_qa_pair_text contains: "다국어 코드 추가... lbl_apv_createdate = 작성일자..."',
    "GOOD answer:",
    '"1) 핵심 답변\\n관리자 페이지에서 다국어 코드를 추가/수정할 수 있습니다.\\n\\n2) 적용 방법\\n- 다국어 코드 형식: lbl_apv_createdate = 작성일자\\n- 관리자 페이지에서 다국어 추가\\n\\n3) 확인 포인트\\n- 서비스 재기동 없이 반영 가능\\n\\n4) 참고 링크\\n[URL]"',
    "BAD answer (절대 사용 금지):",
    '"질문과 유사한 처리 이력..."',
    "",
    "JSON schema:",
    "{",
    '  "selectedRequireId": "candidate require_id or null",',
    '  "selectedSccId": "candidate scc_id string or null",',
    '  "isRelevant": true,',
    '  "answer": "Korean answer with 4 sections: 1) 핵심 답변 2) 적용 방법 3) 확인 포인트 4) 참고 링크. MUST extract actual details from best_qa_pair_text/best_resolution_text/best_action_text. NEVER use generic fallback.",',
    '  "reason": "short Korean reason(1 sentence)"',
    "}",
    "",
    "RULESET:",
    ...PROMPT_RULESET.map((rule, index) => `${index + 1}) ${rule}`),
    "",
    "참고 링크 템플릿:",
    "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx?req_id={selectedRequireId}&system=Menu01&alias=Menu01.Service.List&mnid=705"
  ].join("\n");
}

function buildAnswerPrompt(
  query: string,
  retrieval: ChatResponseBody,
  selectedCandidate: NonNullable<ReturnType<typeof resolveCandidateByRequireId>>
): string {
  // Use longer snippets to capture more actual data (codes, settings, procedures)
  const issueText =
    toPromptSnippet(
      (selectedCandidate.requireId === retrieval.bestRequireId ? retrieval.bestIssueText : null) ??
      selectedCandidate.issuePreview,
      600
    );
  const qaPairText =
    toPromptSnippet(
      (selectedCandidate.requireId === retrieval.bestRequireId ? retrieval.bestQaPairText : null) ??
      selectedCandidate.qaPairPreview,
      1500
    );
  const resolutionText =
    toPromptSnippet(
      (selectedCandidate.requireId === retrieval.bestRequireId ? retrieval.bestResolutionText : null) ??
      selectedCandidate.resolutionPreview,
      800
    );
  const actionText =
    toPromptSnippet(
      (selectedCandidate.requireId === retrieval.bestRequireId ? retrieval.bestActionText : null) ??
      selectedCandidate.actionPreview,
      800
    );

  return [
    "You are a technical support assistant. Answer the user's question in Korean using the provided context.",
    "",
    `Question: ${query}`,
    "",
    "Available context:",
    `Issue description: ${issueText}`,
    `Q&A history: ${qaPairText}`,
    `Resolution: ${resolutionText}`,
    `Action taken: ${actionText}`,
    "",
    "Instructions:",
    "1. Extract specific codes (like lbl_apv_normalapprove, btn_apv_consultor) from the context",
    "2. Include file paths, settings, SQL queries, and procedures if present",
    "3. Write a detailed, concrete answer - no generic statements",
    "4. Use exactly this 4-section format:",
    "",
    "1) 핵심 답변",
    "(Explain the main solution in 2-3 sentences with specific details)",
    "",
    "2) 적용 방법",
    "(List the actual codes, steps, or procedures from the context)",
    "",
    "3) 확인 포인트",
    "(List 2-3 verification steps)",
    "",
    "4) 참고 링크",
    `https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx?req_id=${selectedCandidate.requireId}&system=Menu01&alias=Menu01.Service.List&mnid=705`
  ].join("\n");
}

function extractGeminiText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const parts = root.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }

  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}

function extractJsonObject(text: string): LlmStructuredPayload | null {
  try {
    return JSON.parse(text) as LlmStructuredPayload;
  } catch {
    // keep trying
  }

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const candidate = text.slice(start, index + 1);
          try {
            return JSON.parse(candidate) as LlmStructuredPayload;
          } catch {
            start = -1;
          }
        }
      }
    }
  }

  return null;
}

function parseFieldFromRawText(text: string, fieldName: string): string | null {
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`, "i");
  const match = text.match(regex);
  if (!match || !match[1]) {
    return null;
  }
  return match[1].trim();
}

function parseBooleanFromRawText(text: string, fieldName: string): boolean | null {
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*(true|false)`, "i");
  const match = text.match(regex);
  if (!match || !match[1]) {
    return null;
  }
  return match[1].toLowerCase() === "true";
}

function resolveCandidateByRequireId(
  rawRequireId: string | null,
  retrieval: ChatResponseBody
): (typeof retrieval.candidates)[number] | null {
  if (!rawRequireId) {
    return null;
  }

  const normalized = rawRequireId.trim();
  const exact = retrieval.candidates.find((candidate) => candidate.requireId === normalized);
  if (exact) {
    return exact;
  }

  const prefixMatches = retrieval.candidates.filter(
    (candidate) => candidate.requireId.startsWith(normalized) || normalized.startsWith(candidate.requireId)
  );

  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }

  return null;
}

function parseStructuredAnswer(rawText: string, retrieval: ChatResponseBody): LlmAnswerResult {
  const parsed = extractJsonObject(rawText);
  const answerFromJson = parsed ? normalizeNullableString(parsed.answer) : null;
  const answerFromRaw = parseFieldFromRawText(rawText, "answer");
  const selectedRequireIdFromJson = parsed ? normalizeNullableString(parsed.selectedRequireId) : null;
  const selectedRequireIdFromRaw = parseFieldFromRawText(rawText, "selectedRequireId");
  const selectedSccIdFromJson = parsed ? normalizeNullableString(parsed.selectedSccId) : null;
  const selectedSccIdFromRaw = parseFieldFromRawText(rawText, "selectedSccId");
  const isRelevantFromJson = parsed ? normalizeBoolean(parsed.isRelevant) : null;
  const isRelevantFromRaw = parseBooleanFromRawText(rawText, "isRelevant");

  const selectedCandidate = resolveCandidateByRequireId(
    selectedRequireIdFromJson ?? selectedRequireIdFromRaw,
    retrieval
  );

  const isRelevant = isRelevantFromJson ?? isRelevantFromRaw ?? true;

  // High confidence 케이스는 LLM이 isRelevant=false라고 해도 강제로 활용
  const isHighConfidence = retrieval.confidence >= 0.7;
  const shouldUseCandidate = isRelevant || (isHighConfidence && retrieval.bestRequireId);

  const finalSelectedRequireId = shouldUseCandidate
    ? (selectedCandidate?.requireId ?? retrieval.bestRequireId ?? null)
    : null;
  const finalSelectedSccId = shouldUseCandidate
    ? (selectedSccIdFromJson ?? selectedSccIdFromRaw ?? selectedCandidate?.sccId ?? retrieval.bestSccId ?? null)
    : null;

  // LLM이 답변을 생성하지 못한 경우, retrieval context에서 짧고 정제된 답변 생성
  let fallbackAnswer: string;

  // 노이즈 제거 및 텍스트 정제 함수
  function cleanAndTruncate(text: string | null | undefined, maxLength: number): string | null {
    if (!text || text === "none") return null;

    // [QUESTION], [ANSWER] 등 태그 제거
    let cleaned = text
      .replace(/\[QUESTION\]/gi, "")
      .replace(/\[ANSWER\]/gi, "")
      .replace(/안녕하세요[^\n]*\n?/gi, "")
      .replace(/감사합니다[^\n]*\n?/gi, "")
      .replace(/코비전\s*CS[^\n]*\n?/gi, "")
      .trim();

    // 최대 길이 제한
    if (cleaned.length > maxLength) {
      cleaned = cleaned.slice(0, maxLength) + "...";
    }

    return cleaned.length > 10 ? cleaned : null;
  }

  if (finalSelectedRequireId) {
    const sections: string[] = [];

    // 1) 핵심 답변 - qa_pair 또는 resolution (최대 150자)
    const cleanedQaPair = cleanAndTruncate(retrieval.bestQaPairText, 150);
    const cleanedResolution = cleanAndTruncate(retrieval.bestResolutionText, 150);

    if (cleanedQaPair) {
      sections.push(`1) 핵심 답변\n${cleanedQaPair}`);
    } else if (cleanedResolution) {
      sections.push(`1) 핵심 답변\n${cleanedResolution}`);
    } else {
      sections.push("1) 핵심 답변\n유사한 처리 이력을 찾았습니다. 상세 내용은 아래 참고 링크에서 확인해주세요.");
    }

    // 2) 적용 방법 - action (최대 100자)
    const cleanedAction = cleanAndTruncate(retrieval.bestActionText, 100);
    if (cleanedAction) {
      sections.push(`2) 적용 방법\n${cleanedAction}`);
    } else {
      sections.push(`2) 적용 방법\n참고 링크에서 상세 처리 방법을 확인해주세요.`);
    }

    // 3) 확인 포인트
    sections.push("3) 확인 포인트\n- 처리 후 정상 동작 여부 확인\n- 관련 로그 확인");

    // 4) 참고 링크
    const linkUrl = `https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx?req_id=${finalSelectedRequireId}&system=Menu01&alias=Menu01.Service.List&mnid=705`;
    sections.push(`4) 참고 링크\n${linkUrl}`);

    fallbackAnswer = sections.join("\n\n");
  } else {
    fallbackAnswer = "현재 후보 이력에서 질문과 정확히 일치하는 사례를 특정하기 어렵습니다. 추가 증상/로그 정보를 주시면 재탐색하겠습니다.";
  }

  const answer = answerFromJson ?? answerFromRaw ?? fallbackAnswer;

  return {
    generatedAnswer: answer,
    llmUsed: true,
    llmModel: null,
    llmError: null,
    llmSelectedRequireId: finalSelectedRequireId,
    llmSelectedSccId: finalSelectedSccId,
    llmReRanked:
      finalSelectedRequireId !== null &&
      retrieval.bestRequireId !== null &&
      finalSelectedRequireId !== retrieval.bestRequireId,
    llmRerankUsed: false,
    llmRerankReason: null
  };
}

function formatDirectAnswer(retrieval: ChatResponseBody): LlmAnswerResult {
  if (!retrieval.bestRequireId) {
    return {
      generatedAnswer: "현재 후보 이력에서 질문과 정확히 일치하는 사례를 특정하기 어렵습니다. 추가 증상/로그 정보를 주시면 재탐색하겠습니다.",
      llmUsed: false,
      llmModel: null,
      llmError: "NO_BEST_CANDIDATE",
      llmSelectedRequireId: null,
      llmSelectedSccId: null,
      llmReRanked: false,
      llmRerankUsed: false,
      llmRerankReason: null
    };
  }

  const sections: string[] = [];

  // 1) 핵심 답변 - qa_pair 또는 resolution에서 추출
  const qaPairText = retrieval.bestQaPairText?.trim();
  const resolutionText = retrieval.bestResolutionText?.trim();
  const actionText = retrieval.bestActionText?.trim();

  if (qaPairText && qaPairText !== "none") {
    const lines = qaPairText.split(/[\r\n]+/).filter((line) => line.trim().length > 0);
    const firstFewLines = lines.slice(0, 3).join("\n");
    sections.push(`1) 핵심 답변\n${firstFewLines}`);
  } else if (resolutionText && resolutionText !== "none") {
    const lines = resolutionText.split(/[\r\n]+/).filter((line) => line.trim().length > 0);
    const firstFewLines = lines.slice(0, 3).join("\n");
    sections.push(`1) 핵심 답변\n${firstFewLines}`);
  } else {
    sections.push("1) 핵심 답변\n관련 처리 이력을 찾았습니다. 상세 내용은 참고 링크에서 확인해주세요.");
  }

  // 2) 적용 방법 - action 또는 resolution에서 추출
  if (actionText && actionText !== "none") {
    const lines = actionText.split(/[\r\n]+/).filter((line) => line.trim().length > 0);
    const actionSteps = lines.slice(0, 3).map((line) => `- ${line}`).join("\n");
    sections.push(`2) 적용 방법\n${actionSteps}`);
  } else if (resolutionText && resolutionText !== "none") {
    sections.push(`2) 적용 방법\n상세 처리 방법은 참고 링크의 해결 내역을 확인해주세요.`);
  } else {
    sections.push("2) 적용 방법\n참고 링크에서 상세 처리 절차를 확인해주세요.");
  }

  // 3) 확인 포인트
  const issueText = retrieval.bestIssueText?.trim();
  if (issueText && issueText !== "none") {
    const lines = issueText.split(/[\r\n]+/).filter((line) => line.trim().length > 0);
    const checkPoints = lines.slice(0, 2).map((line) => `- ${line}`).join("\n");
    sections.push(`3) 확인 포인트\n${checkPoints}`);
  } else {
    sections.push("3) 확인 포인트\n- 처리 후 정상 동작 여부 확인\n- 관련 로그 확인");
  }

  // 4) 참고 링크
  const linkUrl = `https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx?req_id=${retrieval.bestRequireId}&system=Menu01&alias=Menu01.Service.List&mnid=705`;
  sections.push(`4) 참고 링크\n${linkUrl}`);

  return {
    generatedAnswer: sections.join("\n\n"),
    llmUsed: false,
    llmModel: null,
    llmError: null,
    llmSelectedRequireId: retrieval.bestRequireId,
    llmSelectedSccId: retrieval.bestSccId ?? null,
    llmReRanked: false,
    llmRerankUsed: false,
    llmRerankReason: "high_confidence_direct_format"
  };
}

function parseSelectionOnly(rawText: string, retrieval: ChatResponseBody): LlmSelectionResult {
  const parsed = extractJsonObject(rawText);
  const selectedRequireIdFromJson = parsed ? normalizeNullableString(parsed.selectedRequireId) : null;
  const selectedRequireIdFromRaw = parseFieldFromRawText(rawText, "selectedRequireId");
  const selectedSccIdFromJson = parsed ? normalizeNullableString(parsed.selectedSccId) : null;
  const selectedSccIdFromRaw = parseFieldFromRawText(rawText, "selectedSccId");
  const isRelevantFromJson = parsed ? normalizeBoolean(parsed.isRelevant) : null;
  const isRelevantFromRaw = parseBooleanFromRawText(rawText, "isRelevant");
  const reasonFromJson = parsed ? normalizeNullableString(parsed.reason) : null;
  const reasonFromRaw = parseFieldFromRawText(rawText, "reason");

  const selectedCandidate = resolveCandidateByRequireId(
    selectedRequireIdFromJson ?? selectedRequireIdFromRaw,
    retrieval
  );
  const isRelevant = isRelevantFromJson ?? isRelevantFromRaw ?? true;

  return {
    selectedRequireId: isRelevant ? selectedCandidate?.requireId ?? null : null,
    selectedSccId: isRelevant
      ? selectedSccIdFromJson ?? selectedSccIdFromRaw ?? selectedCandidate?.sccId ?? null
      : null,
    isRelevant,
    reason: reasonFromJson ?? reasonFromRaw,
    error: null
  };
}

async function invokeGeminiText(
  prompt: string,
  apiKey: string,
  model: string
): Promise<{ text: string | null; error: string | null }> {
  const timeoutMs = parseEnvInt(process.env.LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS);
  const maxOutputTokens = Math.min(
    Math.max(parseEnvInt(process.env.LLM_MAX_OUTPUT_TOKENS, DEFAULT_LLM_MAX_OUTPUT_TOKENS), 128),
    8192
  );
  const temperature = parseEnvNumber(process.env.LLM_TEMPERATURE, 0.2);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature,
          maxOutputTokens
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const bodyText = await response.text();
      return {
        text: null,
        error: `GEMINI_HTTP_${response.status}: ${bodyText.slice(0, 300)}`
      };
    }

    const payload = (await response.json()) as unknown;
    const text = extractGeminiText(payload);
    if (!text) {
      return {
        text: null,
        error: "GEMINI_EMPTY_RESPONSE"
      };
    }

    return {
      text,
      error: null
    };
  } catch (error) {
    return {
      text: null,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function* invokeGeminiTextStream(
  prompt: string,
  apiKey: string,
  model: string
): AsyncGenerator<string, void, undefined> {
  const timeoutMs = parseEnvInt(process.env.LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS);
  const maxOutputTokens = Math.min(
    Math.max(parseEnvInt(process.env.LLM_MAX_OUTPUT_TOKENS, DEFAULT_LLM_MAX_OUTPUT_TOKENS), 128),
    8192
  );
  const temperature = parseEnvNumber(process.env.LLM_TEMPERATURE, 0.2);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature,
          maxOutputTokens,
          // gemini-2.5-flash의 thinking 단계 비활성화 (TTFT 단축)
          ...(model.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {})
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`GEMINI_HTTP_${response.status}: ${bodyText.slice(0, 300)}`);
    }

    if (!response.body) {
      throw new Error("GEMINI_NO_RESPONSE_BODY");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;

        if (trimmed.startsWith("data: ")) {
          try {
            const jsonStr = trimmed.slice(6);
            const payload = JSON.parse(jsonStr) as unknown;
            const text = extractGeminiText(payload);
            if (text) {
              yield text;
            }
          } catch {
            // Skip invalid JSON chunks
          }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithGemini(
  query: string,
  retrieval: ChatResponseBody,
  apiKey: string,
  model: string
): Promise<LlmAnswerResult> {
  const twoStepMaxConfidence = parseEnvNumber(
    process.env.LLM_TWO_STEP_MAX_CONFIDENCE,
    DEFAULT_LLM_TWO_STEP_MAX_CONFIDENCE
  );
  const useTwoStepRerank =
    retrieval.candidates.length > 1 && retrieval.confidence < twoStepMaxConfidence;

  if (useTwoStepRerank) {
    const selectionCall = await invokeGeminiText(buildSelectionPrompt(query, retrieval), apiKey, model);
    if (!selectionCall.error && selectionCall.text) {
      const selection = parseSelectionOnly(selectionCall.text, retrieval);
      const selectedCandidate = resolveCandidateByRequireId(selection.selectedRequireId, retrieval);
      if (selectedCandidate) {
        const answerCall = await invokeGeminiText(
          buildAnswerPrompt(query, retrieval, selectedCandidate),
          apiKey,
          model
        );
        if (!answerCall.error && answerCall.text) {
          return {
            generatedAnswer: answerCall.text.trim(),
            llmUsed: true,
            llmModel: model,
            llmError: null,
            llmSelectedRequireId: selectedCandidate.requireId,
            llmSelectedSccId: selectedCandidate.sccId,
            llmReRanked:
              retrieval.bestRequireId !== null && selectedCandidate.requireId !== retrieval.bestRequireId,
            llmRerankUsed: true,
            llmRerankReason: selection.reason
          };
        }
      }
    }
  }

  // Use plain text format instead of JSON (more reliable)
  const bestCandidate = retrieval.bestRequireId
    ? resolveCandidateByRequireId(retrieval.bestRequireId, retrieval)
    : retrieval.candidates[0];

  if (!bestCandidate) {
    return {
      generatedAnswer: null,
      llmUsed: false,
      llmModel: model,
      llmError: "NO_RETRIEVAL_CANDIDATE",
      llmSelectedRequireId: null,
      llmSelectedSccId: null,
      llmReRanked: false,
      llmRerankUsed: false,
      llmRerankReason: null
    };
  }

  const plainTextCall = await invokeGeminiText(
    buildAnswerPrompt(query, retrieval, bestCandidate),
    apiKey,
    model
  );

  if (plainTextCall.error || !plainTextCall.text) {
    return {
      generatedAnswer: null,
      llmUsed: false,
      llmModel: model,
      llmError: plainTextCall.error ?? "GEMINI_EMPTY_RESPONSE",
      llmSelectedRequireId: null,
      llmSelectedSccId: null,
      llmReRanked: false,
      llmRerankUsed: false,
      llmRerankReason: null
    };
  }

  // DEBUG: Log LLM response (plain text format)
  console.log("=== LLM RAW RESPONSE (PLAIN TEXT) ===");
  console.log("Query:", query.slice(0, 100));
  console.log("Response length:", plainTextCall.text.length);
  console.log("Response preview:", plainTextCall.text.slice(0, 500));
  console.log("=====================================");

  const generatedAnswer = plainTextCall.text.trim();

  return {
    generatedAnswer,
    llmUsed: true,
    llmModel: model,
    llmError: null,
    llmSelectedRequireId: bestCandidate.requireId,
    llmSelectedSccId: bestCandidate.sccId,
    llmReRanked: false,
    llmRerankUsed: false,
    llmRerankReason: null
  };
}

export async function generateChatAnswer(
  query: string,
  retrieval: ChatResponseBody
): Promise<LlmAnswerResult> {
  const provider = (process.env.LLM_PROVIDER ?? "google").toLowerCase();
  const model = process.env.GOOGLE_MODEL ?? "gemini-1.5-flash";
  const apiKey = process.env.GOOGLE_API_KEY?.trim();
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  const cacheKey = [
    model,
    normalizedQuery,
    retrieval.bestRequireId ?? "none",
    retrieval.confidence.toFixed(2),
    retrieval.candidates.slice(0, 5).map((candidate) => `${candidate.requireId}:${candidate.score}`).join("|")
  ].join("::");
  const llmCacheTtlMs = parseEnvInt(
    process.env.LLM_ANSWER_CACHE_TTL_MS,
    DEFAULT_LLM_ANSWER_CACHE_TTL_MS
  );

  if (provider !== "google") {
    return {
      generatedAnswer: null,
      llmUsed: false,
      llmModel: null,
      llmError: `LLM_PROVIDER_NOT_SUPPORTED: ${provider}`,
      llmSelectedRequireId: null,
      llmSelectedSccId: null,
      llmReRanked: false,
      llmRerankUsed: false,
      llmRerankReason: null
    };
  }

  if (!apiKey) {
    return {
      generatedAnswer: null,
      llmUsed: false,
      llmModel: model,
      llmError: "GOOGLE_API_KEY_MISSING",
      llmSelectedRequireId: null,
      llmSelectedSccId: null,
      llmReRanked: false,
      llmRerankUsed: false,
      llmRerankReason: null
    };
  }

  if (retrieval.candidates.length === 0) {
    return {
      generatedAnswer: null,
      llmUsed: false,
      llmModel: model,
      llmError: "NO_RETRIEVAL_CANDIDATE",
      llmSelectedRequireId: null,
      llmSelectedSccId: null,
      llmReRanked: false,
      llmRerankUsed: false,
      llmRerankReason: null
    };
  }

  const cached = getCachedValue(llmAnswerCache, cacheKey);
  if (cached) {
    return cached;
  }

  // Hybrid approach: High confidence = direct format, Low confidence = LLM generation
  const skipOnHighConfidence = process.env.LLM_SKIP_ON_HIGH_CONFIDENCE === "true"
    || (process.env.LLM_SKIP_ON_HIGH_CONFIDENCE === undefined && DEFAULT_LLM_SKIP_ON_HIGH_CONFIDENCE);
  const skipMinConfidence = parseEnvNumber(
    process.env.LLM_SKIP_MIN_CONFIDENCE,
    DEFAULT_LLM_SKIP_MIN_CONFIDENCE
  );

  if (skipOnHighConfidence && retrieval.confidence >= skipMinConfidence && retrieval.bestRequireId) {
    const direct = formatDirectAnswer(retrieval);
    if (direct.generatedAnswer) {
      setCachedValue(llmAnswerCache, cacheKey, direct, llmCacheTtlMs);
    }
    return direct;
  }

  const generated = await generateWithGemini(query, retrieval, apiKey, model);
  if (generated.llmUsed && generated.llmError === null && generated.generatedAnswer) {
    setCachedValue(llmAnswerCache, cacheKey, generated, llmCacheTtlMs);
  }
  return generated;
}

export async function* generateChatAnswerStream(
  query: string,
  retrieval: ChatResponseBody
): AsyncGenerator<string, void, undefined> {
  const provider = (process.env.LLM_PROVIDER ?? "google").toLowerCase();
  const model = process.env.GOOGLE_MODEL ?? "gemini-2.0-flash-exp";
  const apiKey = process.env.GOOGLE_API_KEY ?? "";

  if (provider !== "google") {
    yield "현재 스트리밍은 Google Gemini만 지원합니다.";
    return;
  }

  if (!apiKey) {
    yield "LLM API 키가 설정되지 않았습니다.";
    return;
  }

  if (retrieval.candidates.length === 0) {
    yield "검색 결과가 없습니다. 더 구체적인 정보를 입력해주세요.";
    return;
  }

  try {
    // Use best candidate for streaming
    const bestCandidate = resolveCandidateByRequireId(retrieval.bestRequireId, retrieval);
    if (!bestCandidate) {
      yield "유사한 처리 이력을 찾을 수 없습니다.";
      return;
    }

    // Use answer prompt instead of JSON prompt for better streaming
    const prompt = buildAnswerPrompt(query, retrieval, bestCandidate);
    for await (const chunk of invokeGeminiTextStream(prompt, apiKey, model)) {
      yield chunk;
    }
  } catch (error) {
    yield `\n\n오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`;
  }
}

