import type { Message } from "@/components/chatbot/chat-message"

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}

interface ServerConversationRow {
  session_id: string
  client_session_id: string | null
  title: string | null
  created_at: string
  updated_at: string
  messages?: ServerMessageRow[] | null
}

interface ServerMessageRow {
  message_id: string
  role: "user" | "assistant" | "system"
  content: string
  created_at: string
  status?: string | null
  answer_source?: string | null
  retrieval_mode?: string | null
  confidence?: number | null
  similar_issue_url?: string | null
  metadata?: {
    linkLabel?: string | null
    top3Candidates?: Message["top3Candidates"]
  } | null
  log_uuid?: string | null
}

const CONVERSATIONS_STORAGE_KEY = "covi_ai_conversations_v1"
const ACTIVE_SESSION_KEY = "covi_ai_active_session_v1"
const BROWSER_USER_KEY = "covi_ai_browser_user_v1"
const MAX_CONVERSATIONS = 50

export function generateConversationId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function generateConversationTitle(firstMessage: string): string {
  return firstMessage.length > 30 ? `${firstMessage.slice(0, 30)}...` : firstMessage
}

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") {
    return []
  }

  try {
    const stored = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)
    if (!stored) {
      return []
    }

    const parsed = JSON.parse(stored) as Conversation[]
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((conv) => typeof conv?.id === "string" && Array.isArray(conv?.messages))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } catch {
    return []
  }
}

export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") {
    return
  }

  try {
    const limited = conversations.slice(0, MAX_CONVERSATIONS)
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(limited))
  } catch (error) {
    console.error("Failed to save conversations:", error)
  }
}

export function loadActiveSessionId(): string | null {
  if (typeof window === "undefined") {
    return null
  }

  return window.localStorage.getItem(ACTIVE_SESSION_KEY)
}

export function saveActiveSessionId(sessionId: string): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId)
}

export function clearActiveSessionId(): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.removeItem(ACTIVE_SESSION_KEY)
}

export function getBrowserUserKey(): string {
  if (typeof window === "undefined") {
    return "browser-user-server"
  }

  const existing = window.localStorage.getItem(BROWSER_USER_KEY)
  if (existing) {
    return existing
  }

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `browser-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  window.localStorage.setItem(BROWSER_USER_KEY, generated)
  return generated
}

export function createNewConversation(firstMessage?: string): Conversation {
  const now = new Date().toISOString()
  return {
    id: generateConversationId(),
    title: firstMessage ? generateConversationTitle(firstMessage) : "새 대화",
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function updateConversation(conversations: Conversation[], updatedConversation: Conversation): Conversation[] {
  const index = conversations.findIndex((conv) => conv.id === updatedConversation.id)
  if (index === -1) {
    return [updatedConversation, ...conversations]
  }

  const updated = [...conversations]
  updated[index] = updatedConversation
  return updated.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function mergeConversations(localConversations: Conversation[], serverConversations: Conversation[]): Conversation[] {
  const mergedById = new Map<string, Conversation>()

  for (const conv of localConversations) {
    mergedById.set(conv.id, conv)
  }

  for (const serverConv of serverConversations) {
    const localConv = mergedById.get(serverConv.id)
    if (!localConv) {
      mergedById.set(serverConv.id, serverConv)
      continue
    }

    const serverUpdatedAt = new Date(serverConv.updatedAt).getTime()
    const localUpdatedAt = new Date(localConv.updatedAt).getTime()
    const serverIsAtLeastAsComplete = serverConv.messages.length >= localConv.messages.length

    mergedById.set(
      serverConv.id,
      serverIsAtLeastAsComplete && serverUpdatedAt >= localUpdatedAt ? serverConv : localConv,
    )
  }

  return Array.from(mergedById.values())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_CONVERSATIONS)
}

export function deleteConversation(conversations: Conversation[], conversationId: string): Conversation[] {
  return conversations.filter((conv) => conv.id !== conversationId)
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
    if (convDay.getTime() === today.getTime()) {
      group = "오늘"
    } else if (convDay.getTime() === yesterday.getTime()) {
      group = "어제"
    } else if (convDay >= lastWeek) {
      group = "지난 7일"
    } else {
      group = "이전"
    }

    if (!groups.has(group)) {
      groups.set(group, [])
    }
    groups.get(group)!.push(conv)
  }

  return groups
}

function mapServerMessage(row: ServerMessageRow): Message | null {
  if (row.role !== "user" && row.role !== "assistant") {
    return null
  }

  return {
    id: row.message_id,
    sender: row.role === "user" ? "user" : "bot",
    timestamp: row.created_at,
    content: row.content ?? "",
    title: row.role === "assistant" ? "AI Core" : undefined,
    status: row.status ?? null,
    answerSource: row.answer_source ?? null,
    retrievalMode: row.retrieval_mode ?? null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    linkUrl: row.similar_issue_url ?? null,
    linkLabel: row.metadata?.linkLabel ?? null,
    logId: row.log_uuid ?? null,
    top3Candidates: row.metadata?.top3Candidates ?? null,
    isNewMessage: false,
  }
}

async function fetchServerMessages(sessionId: string): Promise<Message[]> {
  const response = await fetch(`/api/conversations/${sessionId}/messages`, {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.status}`)
  }

  const payload = (await response.json()) as { rows?: ServerMessageRow[] }
  return (payload.rows ?? []).map(mapServerMessage).filter((item): item is Message => item !== null)
}

export async function fetchConversationsFromServer(userKey: string): Promise<Conversation[]> {
  const response = await fetch(`/api/conversations?userKey=${encodeURIComponent(userKey)}&includeMessages=true`, {
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch conversations: ${response.status}`)
  }

  const payload = (await response.json()) as { rows?: ServerConversationRow[] }
  const rows = payload.rows ?? []

  const conversations = await Promise.all(
    rows
      .filter((row) => row.client_session_id)
      .map(async (row) => {
        const messages = Array.isArray(row.messages)
          ? row.messages.map(mapServerMessage).filter((item): item is Message => item !== null)
          : await fetchServerMessages(row.session_id)

        return {
          id: row.client_session_id as string,
          title:
            row.title?.trim() ||
            generateConversationTitle(messages.find((message) => message.sender === "user")?.content ?? "새 대화"),
          messages,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        } satisfies Conversation
      }),
  )

  return conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export async function deleteConversationFromServer(conversationId: string, userKey?: string | null): Promise<void> {
  const query = new URLSearchParams()
  if (userKey) {
    query.set("userKey", userKey)
  }

  const suffix = query.toString() ? `?${query.toString()}` : ""
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}${suffix}`, {
    method: "DELETE",
  })

  if (response.status === 404) {
    return
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(payload?.message ?? payload?.error ?? `Failed to delete conversation: ${response.status}`)
  }
}
