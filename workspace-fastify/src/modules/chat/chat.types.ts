export type RetrievalScope = "all" | "manual" | "scc";
export type RetrievalMode = "hybrid" | "rule_only";
export type AnswerSource = "llm" | "deterministic_fallback" | "rule_only";
export type ChatViewStatus = "matched" | "needs_more_info";
export type VectorStrategy =
  | "pgvector"
  | "array_scan"
  | "query_embedding_unavailable"
  | "query_embedding_cooldown"
  | "disabled"
  | "none";

export interface RetrievalTimings {
  ruleMs: number;
  embeddingMs: number;
  vectorMs: number;
  rerankMs: number;
  retrievalMs: number;
  llmMs?: number;
  totalMs?: number;
  cacheHit?: boolean;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  query: string;
  retrievalScope?: RetrievalScope;
  conversationHistory?: ConversationTurn[];
}

export interface RetrievalDebugRequestBody extends ChatRequestBody {}

export interface ChatCandidate {
  requireId: string;
  sccId: string;
  score: number;
  chunkType: "issue" | "action" | "resolution" | "qa_pair";
  previewText: string;
  issuePreview?: string | null;
  actionPreview?: string | null;
  resolutionPreview?: string | null;
  qaPairPreview?: string | null;
}

export interface ChatResponseView {
  status: ChatViewStatus;
  title: string;
  answerText: string;
  linkLabel: string | null;
  linkUrl: string | null;
  requireId: string | null;
  sccId: string | null;
  confidence: number;
  answerSource: AnswerSource | null;
  retrievalMode: RetrievalMode;
}

export interface ChatResponseBody {
  bestRequireId: string | null;
  bestSccId: string | null;
  confidence: number;
  bestChunkType: string | null;
  bestAnswerText: string | null;
  bestIssueText?: string | null;
  bestActionText?: string | null;
  bestResolutionText?: string | null;
  bestQaPairText?: string | null;
  message: string;
  similarIssueUrl: string | null;
  candidates: ChatCandidate[];
  vectorUsed: boolean;
  retrievalMode: RetrievalMode;
  vectorError: string | null;
  vectorStrategy?: VectorStrategy;
  vectorModelTag?: string | null;
  vectorCandidateCount?: number;
  answerSource?: AnswerSource;
  answerSourceReason?: string | null;
  generatedAnswer?: string | null;
  llmUsed?: boolean;
  llmModel?: string | null;
  llmError?: string | null;
  llmSelectedRequireId?: string | null;
  llmSelectedSccId?: string | null;
  llmReRanked?: boolean;
  llmRerankUsed?: boolean;
  llmRerankReason?: string | null;
  llmSkipped?: boolean;
  llmSkipReason?: string | null;
  timings?: RetrievalTimings;
  display?: ChatResponseView;
}

export interface RetrievalDebugCandidate {
  requireId: string;
  sccId: string;
  score: number;
  ruleScore: number;
  vectorScore: number;
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
  chunkType: "issue" | "action" | "resolution" | "qa_pair";
  hasVectorSignal: boolean;
  hasResolution: boolean;
  hasQaPair: boolean;
  relevancePassed: boolean;
  relevanceReason?: string | null;
  previewText: string;
  issuePreview?: string | null;
  actionPreview?: string | null;
  resolutionPreview?: string | null;
  qaPairPreview?: string | null;
}

export interface RetrievalDebugResponseBody {
  query: string;
  retrievalScope: RetrievalScope;
  intent: {
    needsResolution: boolean;
    hasSymptom: boolean;
    asksStatus: boolean;
  };
  queryContext?: {
    domains: string[];
    workflowStages: string[];
    symptoms: string[];
    hiddenNeeds: string[];
    isFollowUp?: boolean;
    followUpReason?: string | null;
    carryForwardTopics?: string[];
    negativeTerms?: string[];
  };
  queryVariants: {
    lexical: string[];
    embedding: string[];
  };
  rowCount: number;
  requireCount: number;
  bestRequireId: string | null;
  bestSccId: string | null;
  bestChunkType: string | null;
  confidence: number;
  vectorUsed: boolean;
  retrievalMode: RetrievalMode;
  vectorError: string | null;
  vectorStrategy?: VectorStrategy;
  vectorModelTag?: string | null;
  vectorCandidateCount?: number;
  timings?: RetrievalTimings;
  candidates: RetrievalDebugCandidate[];
}

export interface ChunkRow {
  sccId: string;
  requireId: string;
  chunkType: "issue" | "action" | "resolution" | "qa_pair";
  chunkText: string;
  stateWeight: number;
  resolvedWeight: number;
  evidenceWeight: number;
  textLenScore: number;
  techSignalScore: number;
  specificityScore: number;
  closurePenaltyScore: number;
  resolutionStage: number;
}
