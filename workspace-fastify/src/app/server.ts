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
  startLlmCacheCleanupInterval,
  stopLlmCacheCleanupInterval,
} from "../modules/chat/llm.service.js";
import type {
  ChatRequestBody,
  ChatResponseBody,
  RetrievalDebugRequestBody,
  RetrievalScope
} from "../modules/chat/chat.types.js";
import { closeVectorPool } from "../platform/db/vectorClient.js";

const COVISION_SERVICE_VIEW_BASE_URL =
  "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx";

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
  stripped = stripped.replace(/\s+/g, " ").trim();

  return stripped.length > 0 ? stripped : answerBlock.replace(/\s+/g, " ").trim();
}

function cleanSupportText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }

  let stripped = text.replace(/\[QUESTION\]|\[ANSWER\]/gi, " ");
  for (const pattern of ANSWER_NOISE_PATTERNS) {
    stripped = stripped.replace(pattern, " ");
  }
  stripped = stripped.replace(/\s+/g, " ").trim();
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
      service: "workspace-fastify"
    };
  });

  app.get("/test/chat", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(renderChatTestPage());
  });

  app.post<{ Body: ChatRequestBody }>("/chat", async (request, reply) => {
    const totalStartedAt = Date.now();
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
      const retrievalStartedAt = Date.now();
      const result = await runChatSearch(query, scope);
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
        llmResultRaw = await generateChatAnswer(query, result);
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

      return reply.code(200).send({
        ...result,
        bestRequireId: selectedRequireId,
        bestSccId: selectedSccId,
        similarIssueUrl: hasRetrievalMatch ? (selectedUrl ?? result.similarIssueUrl) : null,
        answerSource,
        answerSourceReason,
        ...llmResult,
        llmSkipped,
        llmSkipReason,
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

    // 보안 차단 키워드 검사
    if (containsBlockedKeyword(query)) {
      request.log.warn({ query }, "Blocked query due to security keywords");
      return reply.code(200).send({
        error: "SECURITY_BLOCKED",
        message: "보안 정책상 해당 질문에 대해서는 답변할 수 없습니다.\n\n보안 관련 문의는 담당자에게 직접 문의해 주시기 바랍니다."
      });
    }

    try {
      const retrievalStartedAt = Date.now();
      const result = await runChatSearch(query, scope);
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
        return reply.code(200).send({
          error: "NO_MATCH",
          message: "검색 결과가 없습니다."
        });
      }

      // Set headers for Server-Sent Events
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });

      // Send metadata first
      const metadata = {
        bestRequireId: result.bestRequireId,
        bestSccId: result.bestSccId,
        confidence: result.confidence,
        answerSource: "llm_stream",
        retrievalMode: result.retrievalMode
      };
      reply.raw.write(`data: ${JSON.stringify({ type: "metadata", data: metadata })}\n\n`);

      // Stream the answer
      let chunkCount = 0;
      for await (const chunk of generateChatAnswerStream(query, result)) {
        chunkCount++;
        const timestamp = Date.now();
        request.log.info({ chunkCount, timestamp, chunkLength: chunk.length }, "Sending chunk");
        reply.raw.write(`data: ${JSON.stringify({ type: "chunk", data: chunk })}\n\n`);
      }

      // Send done signal
      request.log.info({ totalChunks: chunkCount }, "Stream completed");
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
      const result = await runChatSearchDebug(query, scope);
      return reply.code(200).send(result);
    } catch (error) {
      request.log.error(error, "failed to run /retrieval/search");
      return reply.code(500).send({
        error: "RETRIEVAL_DEBUG_FAILED",
        message: "Failed to run retrieval debug search."
      });
    }
  });

  app.addHook("onClose", async () => {
    stopCacheCleanupInterval();
    stopLlmCacheCleanupInterval();
    await closeVectorPool();
  });

  return app;
}
