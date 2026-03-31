"use client"

import { useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { ChatArea } from "@/components/chatbot/chat-area"
import { ConversationsPanel } from "@/components/chatbot/conversations-panel"
import type { Message } from "@/components/chatbot/chat-message"
import type { Conversation } from "@/lib/conversations"
import {
  loadConversations,
  saveConversations,
  loadActiveSessionId,
  saveActiveSessionId,
  createNewConversation,
  updateConversation,
  deleteConversation,
  generateConversationTitle,
} from "@/lib/conversations"

interface ChatDisplay {
  title?: string | null
  answerText?: string | null
  linkUrl?: string | null
  linkLabel?: string | null
  status?: string | null
  answerSource?: string | null
  retrievalMode?: string | null
  confidence?: number | null
}

interface ChatApiResponse {
  display?: ChatDisplay
  generatedAnswer?: string | null
  message?: string | null
  logId?: string | null
}

const quickFallbackAnswer =
  "현재 AI Core 응답을 가져오지 못했습니다. 잠시 후 다시 시도하거나, 구체적인 오류 문구와 화면 경로를 함께 입력해 주세요."

function toMessageFromDisplay(display: ChatDisplay | undefined, fallbackText: string, logId?: string | null): Message {
  return {
    id: crypto.randomUUID(),
    sender: "bot",
    timestamp: new Date(),
    title: display?.title ?? "AI Core",
    content: display?.answerText ?? fallbackText,
    linkUrl: display?.linkUrl ?? null,
    linkLabel: display?.linkLabel ?? null,
    status: display?.status ?? null,
    answerSource: display?.answerSource ?? null,
    retrievalMode: display?.retrievalMode ?? null,
    confidence: typeof display?.confidence === "number" ? display.confidence : null,
    logId: logId ?? null,
  }
}

export default function ChatbotPage() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("darkMode") === "true"
  })
  const [isTyping, setIsTyping] = useState(false)

  // 대화 관리
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<Message[]>([])

  // 초기 로드
  useEffect(() => {
    const loadedConversations = loadConversations()
    setConversations(loadedConversations)

    const savedActiveId = loadActiveSessionId()
    if (savedActiveId && loadedConversations.some((conv) => conv.id === savedActiveId)) {
      setActiveConversationId(savedActiveId)
      const activeConv = loadedConversations.find((conv) => conv.id === savedActiveId)
      if (activeConv) {
        setCurrentMessages(activeConv.messages)
      }
    } else if (loadedConversations.length > 0) {
      // 가장 최근 대화 선택
      const latestConv = loadedConversations[0]
      setActiveConversationId(latestConv.id)
      setCurrentMessages(latestConv.messages)
      saveActiveSessionId(latestConv.id)
    }
  }, [])

  // 다크모드
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
    localStorage.setItem("darkMode", String(isDarkMode))
  }, [isDarkMode])

  // 대화 저장
  useEffect(() => {
    if (activeConversationId && currentMessages.length > 0) {
      const existingConv = conversations.find((conv) => conv.id === activeConversationId)

      // 제목 결정: 기존 제목이 "새 대화"이면 첫 메시지로 업데이트, 아니면 기존 제목 유지
      const shouldUpdateTitle = !existingConv?.title || existingConv.title === "새 대화"
      const title = shouldUpdateTitle
        ? generateConversationTitle(currentMessages[0]?.content ?? "새 대화")
        : existingConv.title

      const updatedConv: Conversation = {
        id: activeConversationId,
        title,
        messages: currentMessages,
        createdAt: existingConv?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const newConversations = updateConversation(conversations, updatedConv)
      setConversations(newConversations)
      saveConversations(newConversations)
    }
  }, [currentMessages, activeConversationId])

  // 새 대화 시작
  function handleNewConversation() {
    const newConv = createNewConversation()
    setActiveConversationId(newConv.id)
    setCurrentMessages([])
    saveActiveSessionId(newConv.id)

    const newConversations = [newConv, ...conversations]
    setConversations(newConversations)
    saveConversations(newConversations)
  }

  // 대화 선택
  function handleSelectConversation(conversationId: string) {
    setActiveConversationId(conversationId)
    saveActiveSessionId(conversationId)

    const selectedConv = conversations.find((conv) => conv.id === conversationId)
    if (selectedConv) {
      setCurrentMessages(selectedConv.messages)
    }
  }

  // 대화 삭제
  function handleDeleteConversation(conversationId: string) {
    const newConversations = deleteConversation(conversations, conversationId)
    setConversations(newConversations)
    saveConversations(newConversations)

    // 삭제한 대화가 활성 대화인 경우
    if (conversationId === activeConversationId) {
      if (newConversations.length > 0) {
        // 다른 대화 선택
        const nextConv = newConversations[0]
        setActiveConversationId(nextConv.id)
        setCurrentMessages(nextConv.messages)
        saveActiveSessionId(nextConv.id)
      } else {
        // 대화가 없으면 새 대화 시작 (삭제 후의 상태를 기반으로)
        const newConv = createNewConversation()
        setActiveConversationId(newConv.id)
        setCurrentMessages([])
        saveActiveSessionId(newConv.id)

        const updatedConversations = [newConv, ...newConversations]
        setConversations(updatedConversations)
        saveConversations(updatedConversations)
      }
    }
  }

  // 채팅 내보내기
  function handleExportChat() {
    if (currentMessages.length === 0) return

    const lines: string[] = [
      "=== 코비전 CS AI Core 대화 내보내기 ===",
      `내보낸 시각: ${new Date().toLocaleString("ko-KR")}`,
      "",
    ]

    for (const msg of currentMessages) {
      const ts = new Date(msg.timestamp)
      const time = ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
      const sender = msg.sender === "user" ? "사용자" : (msg.title ?? "AI Core")
      lines.push(`[${time}] ${sender}`)
      lines.push(msg.content)
      if (msg.linkUrl) lines.push(`  링크: ${msg.linkUrl}`)
      lines.push("")
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `chat_export_${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 메시지 전송 (스트리밍 방식)
  async function submitMessage(content: string) {
    // 활성 대화가 없으면 새로 생성
    let convId = activeConversationId
    if (!convId) {
      const newConv = createNewConversation(content)
      convId = newConv.id
      setActiveConversationId(convId)
      saveActiveSessionId(convId)

      const newConversations = [newConv, ...conversations]
      setConversations(newConversations)
      saveConversations(newConversations)
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      content,
      sender: "user",
      timestamp: new Date(),
    }
    setCurrentMessages((prev) => [...prev, userMessage])

    // Create a temporary assistant message for streaming
    const assistantMessageId = crypto.randomUUID()
    const assistantMessage: Message = {
      id: assistantMessageId,
      sender: "bot",
      timestamp: new Date(),
      title: "AI Core",
      content: "",
      status: "searching", // 검색 시작 상태
      answerSource: null,
      retrievalMode: null,
      confidence: null,
      linkUrl: null,
      linkLabel: null,
      isNewMessage: true, // 새로 생성되는 메시지이므로 타이핑 효과 적용
    }
    setCurrentMessages((prev) => [...prev, assistantMessage])
    setIsTyping(false) // 스트리밍 메시지 자체가 보이므로 로딩 인디케이터는 숨김

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: content,
          retrievalScope: "all",
          conversationHistory: currentMessages
            .filter((m) => m.sender === "user" || (m.sender === "bot" && m.content && m.status === "matched"))
            .slice(-6)
            .map((m) => ({ role: m.sender === "user" ? "user" : "assistant", content: m.content })),
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // Check if response is JSON (error or no match) or streaming
      const contentType = response.headers.get("content-type")
      if (contentType?.includes("application/json")) {
        // Handle JSON response (no match or error)
        const jsonData = await response.json()
        const isSecurityBlocked = jsonData.error === "SECURITY_BLOCKED"
        const noMatchMessage: Message = {
          id: crypto.randomUUID(),
          sender: "bot",
          timestamp: new Date(),
          title: isSecurityBlocked ? "보안 정책" : "유사 사례 없음",
          content: jsonData.message || "관련 처리 이력을 찾지 못했습니다.\n\n더 구체적인 증상이나 메뉴명을 포함해서 다시 질문해 주세요.",
          status: jsonData.error || "no_match",
          answerSource: "no_match",
        }
        // Replace the temporary message
        setCurrentMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? noMatchMessage : msg))
        )
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error("No response body")
      }

      const decoder = new TextDecoder()
      let buffer = ""
      let accumulatedText = ""
      let metadata: Record<string, unknown> | null = null
      let capturedLogId: string | null = null
      let capturedTop3: import("@/components/chatbot/chat-message").CandidateCard[] | null = null

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith("data: ")) continue

            try {
              const jsonStr = trimmed.slice(6)
              const event = JSON.parse(jsonStr)

              if (event.type === "metadata") {
                metadata = event.data
                if (typeof event.data?.logId === "string") capturedLogId = event.data.logId
                if (Array.isArray(event.data?.top3Candidates)) capturedTop3 = event.data.top3Candidates as import("@/components/chatbot/chat-message").CandidateCard[]
                // metadata 수신 즉시 링크/상태 표시 — 첫 chunk 전 5초 공백 제거
                const earlyLinkUrl = typeof metadata?.similarIssueUrl === "string"
                  ? metadata.similarIssueUrl
                  : null
                const earlyLinkLabel = earlyLinkUrl ? "유사 이력 바로가기" : null
                setCurrentMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          content: "답변을 생성하고 있습니다...",
                          linkUrl: earlyLinkUrl,
                          linkLabel: earlyLinkLabel,
                          status: "generating",
                        }
                      : msg
                  )
                )
              } else if (event.type === "chunk") {
                accumulatedText += event.data
                // 첫 chunk 도착 시 "생성 중" 텍스트를 실제 내용으로 교체하며 실시간 렌더링
                setCurrentMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId ? { ...msg, content: accumulatedText, status: "streaming" } : msg
                  )
                )
              } else if (event.type === "done") {
                // 스트리밍 완료 — 링크/메타데이터 최종 확정
                const finalLinkUrl = typeof metadata?.similarIssueUrl === "string"
                  ? metadata.similarIssueUrl
                  : null
                const finalLinkLabel = finalLinkUrl ? "유사 이력 바로가기" : null
                setCurrentMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          content: accumulatedText,
                          ...metadata,
                          linkUrl: finalLinkUrl,
                          linkLabel: finalLinkLabel,
                          logId: capturedLogId,
                          top3Candidates: capturedTop3 ?? undefined,
                          status: "matched",
                          isNewMessage: false,
                        }
                      : msg
                  )
                )
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      } finally {
        // 스트림 리더 정리 (메모리 누수 방지)
        reader.releaseLock()
      }
    } catch (error) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        sender: "bot",
        timestamp: new Date(),
        title: "연결 오류",
        content: quickFallbackAnswer,
        status: "error",
        answerSource: "proxy_error",
      }
      // Replace the temporary message with error message
      setCurrentMessages((prev) =>
        prev.map((msg) => (msg.id === assistantMessageId ? errorMessage : msg))
      )
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* 왼쪽: 대화 목록 */}
      <div className="w-64 border-r border-border">
        <ConversationsPanel
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      </div>

      {/* 오른쪽: 채팅 영역 */}
      <main className="flex-1 overflow-hidden">
        <ChatArea
          messages={currentMessages}
          isTyping={isTyping}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          onSendMessage={submitMessage}
          onExportChat={handleExportChat}
        />
      </main>
    </div>
  )
}
