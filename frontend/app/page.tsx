"use client"

// crypto.randomUUID 구형 브라우저 폴리필
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

import { useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { ChatArea } from "@/components/chatbot/chat-area"
import { ConversationsPanel } from "@/components/chatbot/conversations-panel"
import type { Message } from "@/components/chatbot/chat-message"
import { toast } from "@/hooks/use-toast"
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
    id: generateUUID(),
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
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [inputPrefill, setInputPrefill] = useState<{ value: string; seq: number } | undefined>(undefined)

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
      const latestConv = loadedConversations[0]
      setActiveConversationId(latestConv.id)
      setCurrentMessages(latestConv.messages)
      saveActiveSessionId(latestConv.id)
    }
  }, [])

  // 다크모드 — 마운트 시 localStorage에서 복원
  useEffect(() => {
    const saved = localStorage.getItem("darkMode") === "true"
    if (saved) setIsDarkMode(true)
  }, [])

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

  // 새 대화 시작 — 이미 빈 대화가 있으면 그쪽으로 이동
  function handleNewConversation() {
    const existingEmpty = conversations.find((conv) => conv.messages.length === 0)
    if (existingEmpty) {
      setActiveConversationId(existingEmpty.id)
      setCurrentMessages([])
      saveActiveSessionId(existingEmpty.id)
      return
    }

    const newConv = createNewConversation()
    setActiveConversationId(newConv.id)
    setCurrentMessages([])
    saveActiveSessionId(newConv.id)

    const newConversations = [newConv, ...conversations]
    setConversations(newConversations)
    saveConversations(newConversations)
  }

  function handleSelectConversation(conversationId: string) {
    setActiveConversationId(conversationId)
    saveActiveSessionId(conversationId)

    const selectedConv = conversations.find((conv) => conv.id === conversationId)
    if (selectedConv) {
      setCurrentMessages(selectedConv.messages)
    }
  }

  function handleDeleteConversation(conversationId: string) {
    const newConversations = deleteConversation(conversations, conversationId)
    setConversations(newConversations)
    saveConversations(newConversations)

    if (conversationId === activeConversationId) {
      if (newConversations.length > 0) {
        const nextConv = newConversations[0]
        setActiveConversationId(nextConv.id)
        setCurrentMessages(nextConv.messages)
        saveActiveSessionId(nextConv.id)
      } else {
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

  function handleEditQuestion(query: string) {
    setInputPrefill((prev) => ({ value: query, seq: (prev?.seq ?? 0) + 1 }))
  }

  function handleRetry() {
    const lastUserMessage = [...currentMessages].reverse().find((m) => m.sender === "user")
    if (!lastUserMessage) return

    const lastUserIdx = currentMessages.map((_, i) => i).filter((i) => currentMessages[i].sender === "user").pop()
    if (lastUserIdx === undefined) return

    flushSync(() => {
      setCurrentMessages((prev) => prev.slice(0, lastUserIdx))
    })
    submitMessage(lastUserMessage.content)
  }

  function handleExportChat() {
    if (currentMessages.length === 0) {
      toast({
        title: "내보낼 대화가 없습니다",
        description: "메시지가 생긴 뒤 다시 시도해 주세요.",
        variant: "destructive",
      })
      return
    }

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
    const fileName = `chat_export_${new Date().toISOString().slice(0, 10)}.txt`
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: "대화를 내보냈습니다",
      description: fileName,
    })
  }

  async function submitMessage(content: string) {
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
      id: generateUUID(),
      content,
      sender: "user",
      timestamp: new Date(),
    }
    setCurrentMessages((prev) => [...prev, userMessage])

    const assistantMessageId = generateUUID()
    const assistantMessage: Message = {
      id: assistantMessageId,
      sender: "bot",
      timestamp: new Date(),
      title: "AI Core",
      content: "",
      status: "searching",
      answerSource: null,
      retrievalMode: null,
      confidence: null,
      linkUrl: null,
      linkLabel: null,
      isNewMessage: true,
    }
    setCurrentMessages((prev) => [...prev, assistantMessage])
    setIsTyping(false)

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: content,
          retrievalScope: "all",
          conversationId: convId,
          conversationHistory: currentMessages
            .filter((m) => m.sender === "user" || (m.sender === "bot" && m.content && m.status === "matched"))
            .slice(-6)
            .map((m) => ({ role: m.sender === "user" ? "user" : "assistant", content: m.content })),
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const contentType = response.headers.get("content-type")
      if (contentType?.includes("application/json")) {
        const jsonData = await response.json()
        const isSecurityBlocked = jsonData.error === "SECURITY_BLOCKED"
        const noMatchMessage: Message = {
          id: generateUUID(),
          sender: "bot",
          timestamp: new Date(),
          title: isSecurityBlocked ? "보안 정책" : "유사 사례 없음",
          content: jsonData.message || "관련 처리 이력을 찾지 못했습니다.\n\n더 구체적인 증상이나 메뉴명을 포함해서 다시 질문해 주세요.",
          status: jsonData.error || "no_match",
          answerSource: "no_match",
        }
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
                if (Array.isArray(event.data?.top3Candidates)) {
                  capturedTop3 = event.data.top3Candidates as import("@/components/chatbot/chat-message").CandidateCard[]
                }
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
                setCurrentMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId ? { ...msg, content: accumulatedText, status: "streaming" } : msg
                  )
                )
              } else if (event.type === "done") {
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
              // ignore invalid JSON line
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    } catch {
      const errorMessage: Message = {
        id: generateUUID(),
        sender: "bot",
        timestamp: new Date(),
        title: "연결 오류",
        content: quickFallbackAnswer,
        status: "error",
        answerSource: "proxy_error",
      }
      setCurrentMessages((prev) =>
        prev.map((msg) => (msg.id === assistantMessageId ? errorMessage : msg))
      )
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={[
          "fixed inset-y-0 left-0 z-30 w-64 border-r border-border bg-card transition-transform duration-200",
          "md:relative md:translate-x-0 md:z-auto",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <ConversationsPanel
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={(id) => {
            handleSelectConversation(id)
            setIsSidebarOpen(false)
          }}
          onNewConversation={() => {
            handleNewConversation()
            setIsSidebarOpen(false)
          }}
          onDeleteConversation={handleDeleteConversation}
          onClose={() => setIsSidebarOpen(false)}
        />
      </div>

      <main className="flex-1 overflow-hidden">
        <ChatArea
          messages={currentMessages}
          isTyping={isTyping}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          onSendMessage={submitMessage}
          onExportChat={handleExportChat}
          onRetry={handleRetry}
          onEditQuestion={handleEditQuestion}
          inputPrefill={inputPrefill}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />
      </main>
    </div>
  )
}
