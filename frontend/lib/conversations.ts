import type { Message } from "@/components/chatbot/chat-message"

export interface Conversation {
  id: string          // client_session_id — 백엔드로 conversationId로 전송되는 값
  sessionId?: string  // DB session_id — DELETE/messages API 호출에 사용
  title: string
  messageCount: number
  messages: Message[]
  messagesLoaded: boolean
  createdAt: string
  updatedAt: string
}

const USER_KEY_STORAGE = "covi_ai_user_key"
const ACTIVE_SESSION_STORAGE = "covi_ai_active_session"

export function getUserKey(): string {
  if (typeof window === "undefined") return ""
  let key = window.localStorage.getItem(USER_KEY_STORAGE)
  if (!key) {
    key =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `user-${Date.now()}-${Math.random().toString(36).slice(2)}`
    window.localStorage.setItem(USER_KEY_STORAGE, key)
  }
  return key
}

export function loadActiveSessionId(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(ACTIVE_SESSION_STORAGE)
}

export function saveActiveSessionId(id: string): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ACTIVE_SESSION_STORAGE, id)
}

export function generateConversationTitle(firstMessage: string): string {
  return firstMessage.length > 30 ? `${firstMessage.slice(0, 30)}...` : firstMessage
}

interface DbSessionRow {
  session_id: string
  client_session_id?: string | null
  title?: string | null
  message_count?: number | null
  created_at: string
  updated_at: string
}

interface DbMessageRow {
  message_id: string
  role: string
  content: string
  status?: string | null
  answer_source?: string | null
  retrieval_mode?: string | null
  confidence?: number | null
  similar_issue_url?: string | null
  log_uuid?: string | null
  created_at: string
}

export async function fetchConversations(userKey: string): Promise<Conversation[]> {
  if (!userKey) return []
  try {
    const res = await fetch(`/api/conversations?userKey=${encodeURIComponent(userKey)}`)
    if (!res.ok) return []
    const data = await res.json()
    const rows: DbSessionRow[] = data.rows ?? []
    return rows.map((row) => ({
      id: row.client_session_id ?? row.session_id,
      sessionId: row.session_id,
      title: row.title ?? "새 대화",
      messageCount: row.message_count ?? 0,
      messages: [],
      messagesLoaded: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  } catch {
    return []
  }
}

export async function fetchMessages(sessionId: string): Promise<Message[]> {
  try {
    const res = await fetch(`/api/conversations/${sessionId}/messages`)
    if (!res.ok) return []
    const data = await res.json()
    const rows: DbMessageRow[] = data.rows ?? []
    return rows.map((row) => ({
      id: row.message_id,
      sender: (row.role === "user" ? "user" : "bot") as "user" | "bot",
      content: row.content,
      timestamp: new Date(row.created_at),
      title: row.role === "assistant" ? "코비전 CS Bot" : undefined,
      status: row.status ?? (row.role === "assistant" ? "matched" : undefined),
      answerSource: row.answer_source ?? null,
      retrievalMode: row.retrieval_mode ?? null,
      confidence: row.confidence ?? null,
      linkUrl: row.similar_issue_url ?? null,
      linkLabel: row.similar_issue_url ? "유사 이력 바로가기" : null,
      logId: row.log_uuid ?? null,
    }))
  } catch {
    return []
  }
}

export async function deleteConversationFromDb(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/conversations/${sessionId}`, { method: "DELETE" })
    return res.ok
  } catch {
    return false
  }
}

export function groupConversationsByDate(conversations: Conversation[]): Map<string, Conversation[]> {
  const groups = new Map<string, Conversation[]>()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const lastWeek = new Date(today)
  lastWeek.setDate(lastWeek.getDate() - 7)

  for (const conv of conversations) {
    const convDate = new Date(conv.updatedAt)
    const convDay = new Date(convDate.getFullYear(), convDate.getMonth(), convDate.getDate())

    let group: string
    if (convDay.getTime() === today.getTime()) group = "오늘"
    else if (convDay.getTime() === yesterday.getTime()) group = "어제"
    else if (convDay >= lastWeek) group = "지난 7일"
    else group = "이전"

    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(conv)
  }

  return groups
}
