import type { Message } from "@/components/chatbot/chat-message"

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}

const CONVERSATIONS_STORAGE_KEY = "covi_ai_conversations_v1"
const ACTIVE_SESSION_KEY = "covi_ai_active_session_v1"
const MAX_CONVERSATIONS = 50

export function generateConversationId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function generateConversationTitle(firstMessage: string): string {
  // 첫 메시지의 처음 30자를 제목으로 사용
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
    // 새 대화 추가
    return [updatedConversation, ...conversations]
  }

  // 기존 대화 업데이트
  const updated = [...conversations]
  updated[index] = updatedConversation
  return updated
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
