import type { CandidateCard, ManualCandidateCard, Message } from "@/components/chatbot/chat-message"

const CHAT_REPLAY_STORAGE_KEY = "covi_ai_chat_replay_v1"

export interface ChatReplayPayload {
  query: string
  answerText: string
  answerSource?: string | null
  retrievalMode?: string | null
  confidence?: number | null
  linkUrl?: string | null
  linkLabel?: string | null
  logId?: string | null
  top3Candidates?:
    | Array<{
        requireId?: string | null
        sccId?: string | number | null
        score?: number | null
        chunkType?: string | null
        previewText?: string | null
        linkUrl?: string | null
      }>
    | null
  manualCandidates?:
    | Array<{
        documentId?: string | null
        chunkId?: string | null
        score?: number | null
        product?: string | null
        title?: string | null
        version?: string | null
        sectionTitle?: string | null
        previewText?: string | null
        linkUrl?: string | null
        sourceLabel?: string | null
        previewImageUrl?: string | null
        previewImageConfidence?: "high" | "low" | null
        previewImageReason?: string | null
        previewPageNumber?: number | null
      }>
    | null
  createdAt?: string | null
}

function generateReplayId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `replay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function storeChatReplayPayload(payload: ChatReplayPayload): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(CHAT_REPLAY_STORAGE_KEY, JSON.stringify(payload))
}

export function consumeChatReplayPayload(): ChatReplayPayload | null {
  if (typeof window === "undefined") return null

  const raw = window.localStorage.getItem(CHAT_REPLAY_STORAGE_KEY)
  if (!raw) return null

  window.localStorage.removeItem(CHAT_REPLAY_STORAGE_KEY)

  try {
    return JSON.parse(raw) as ChatReplayPayload
  } catch {
    return null
  }
}

export function buildReplayMessages(payload: ChatReplayPayload): Message[] {
  const timestamp = payload.createdAt ? new Date(payload.createdAt) : new Date()
  const top3Candidates: CandidateCard[] =
    payload.top3Candidates?.flatMap((candidate) => {
      if (!candidate.requireId || !candidate.linkUrl) return []
      return [
        {
          requireId: candidate.requireId,
          sccId: String(candidate.sccId ?? ""),
          score: candidate.score ?? 0,
          chunkType: candidate.chunkType ?? "unknown",
          previewText: candidate.previewText ?? "",
          linkUrl: candidate.linkUrl,
        },
      ]
    }) ?? []

  const manualCandidates: ManualCandidateCard[] =
    payload.manualCandidates?.flatMap((candidate) => {
      if (!candidate.documentId || !candidate.chunkId) return []
      return [
        {
          documentId: candidate.documentId,
          chunkId: candidate.chunkId,
          score: candidate.score ?? 0,
          product: candidate.product ?? "",
          title: candidate.title ?? "매뉴얼 후보",
          version: candidate.version ?? null,
          sectionTitle: candidate.sectionTitle ?? null,
          previewText: candidate.previewText ?? "",
          linkUrl: candidate.linkUrl ?? null,
          sourceLabel: candidate.sourceLabel ?? null,
          previewImageUrl: candidate.previewImageUrl ?? null,
          previewImageConfidence: candidate.previewImageConfidence ?? null,
          previewImageReason: candidate.previewImageReason ?? null,
          previewPageNumber: candidate.previewPageNumber ?? null,
        },
      ]
    }) ?? []

  return [
    {
      id: generateReplayId(),
      sender: "user",
      content: payload.query,
      timestamp,
    },
    {
      id: generateReplayId(),
      sender: "bot",
      title: "AI Core Replay",
      content: payload.answerText,
      timestamp,
      status: "matched",
      answerSource: payload.answerSource ?? null,
      retrievalMode: payload.retrievalMode ?? null,
      confidence: payload.confidence ?? null,
      linkUrl: payload.linkUrl ?? null,
      linkLabel: payload.linkLabel ?? null,
      logId: payload.logId ?? null,
      top3Candidates,
      manualCandidates,
      isNewMessage: false,
    },
  ]
}
