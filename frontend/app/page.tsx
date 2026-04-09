"use client"

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

import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { ChatArea } from "@/components/chatbot/chat-area"
import { ConversationsPanel } from "@/components/chatbot/conversations-panel"
import type { Message } from "@/components/chatbot/chat-message"
import { toast } from "@/hooks/use-toast"
import type { Conversation } from "@/lib/conversations"
import {
  getUserKey,
  loadActiveSessionId,
  saveActiveSessionId,
  generateConversationTitle,
  fetchConversations,
  fetchMessages,
  deleteConversationFromDb,
} from "@/lib/conversations"

const quickFallbackAnswer =
  "현재 AI Core 응답을 가져오지 못했습니다. 잠시 후 다시 시도하거나, 구체적인 오류 문구와 화면 경로를 함께 입력해 주세요."

export default function ChatbotPage() {
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [inputPrefill, setInputPrefill] = useState<{ value: string; seq: number } | undefined>(undefined)

  const [userKey, setUserKey] = useState<string>("")
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<Message[]>([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)

  // 초기 로드: userKey 생성 → DB에서 대화 목록 fetch
  useEffect(() => {
    const key = getUserKey()
    setUserKey(key)

    fetchConversations(key).then((convs) => {
      setConversations(convs)

      const savedActiveId = loadActiveSessionId()
      const target = savedActiveId
        ? convs.find((c) => c.id === savedActiveId) ?? convs[0]
        : convs[0]

      if (target) {
        setActiveConversationId(target.id)
        loadConversationMessages(target)
      }
    })
  }, [])

  // 다크모드 복원
  useEffect(() => {
    const saved = localStorage.getItem("darkMode") === "true"
    if (saved) setIsDarkMode(true)
  }, [])

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add("dark")
    else document.documentElement.classList.remove("dark")
    localStorage.setItem("darkMode", String(isDarkMode))
  }, [isDarkMode])

  async function loadConversationMessages(conv: Conversation) {
    if (conv.messagesLoaded) {
      setCurrentMessages(conv.messages)
      return
    }
    if (!conv.sessionId) {
      setCurrentMessages([])
      return
    }
    setIsLoadingMessages(true)
    const msgs = await fetchMessages(conv.sessionId)
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conv.id ? { ...c, messages: msgs, messagesLoaded: true } : c
      )
    )
    setCurrentMessages(msgs)
    setIsLoadingMessages(false)
  }

  // DB에서 대화 목록 갱신 (메시지 전송 완료 후 호출)
  async function refreshConversations(activeId: string, currentMsgs: Message[]) {
    if (!userKey) return
    const convs = await fetchConversations(userKey)
    setConversations((prev) => {
      return convs.map((fresh) => {
        const existing = prev.find((p) => p.id === fresh.id)
        if (existing?.messagesLoaded) {
          return { ...fresh, messages: existing.messages, messagesLoaded: true }
        }
        return fresh
      })
    })
    // 현재 활성 대화 메시지는 in-memory 유지
    setCurrentMessages(currentMsgs)
    // 새 대화가 DB에 생겼으면 sessionId 업데이트
    const matched = convs.find((c) => c.id === activeId)
    if (matched) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, sessionId: matched.sessionId, messageCount: matched.messageCount }
            : c
        )
      )
    }
  }

  function handleNewConversation() {
    // 이미 빈 새 대화가 있으면 그쪽으로
    const existingEmpty = conversations.find((c) => c.messageCount === 0 && !c.messagesLoaded)
    if (existingEmpty) {
      setActiveConversationId(existingEmpty.id)
      setCurrentMessages([])
      saveActiveSessionId(existingEmpty.id)
      return
    }

    const newId = generateUUID()
    const now = new Date().toISOString()
    const newConv: Conversation = {
      id: newId,
      title: "새 대화",
      messageCount: 0,
      messages: [],
      messagesLoaded: true,
      createdAt: now,
      updatedAt: now,
    }
    setConversations((prev) => [newConv, ...prev])
    setActiveConversationId(newId)
    setCurrentMessages([])
    saveActiveSessionId(newId)
  }

  function handleSelectConversation(conversationId: string) {
    if (conversationId === activeConversationId) return
    setActiveConversationId(conversationId)
    saveActiveSessionId(conversationId)

    const conv = conversations.find((c) => c.id === conversationId)
    if (conv) loadConversationMessages(conv)
  }

  async function handleDeleteConversation(conversationId: string) {
    const conv = conversations.find((c) => c.id === conversationId)
    if (conv?.sessionId) {
      await deleteConversationFromDb(conv.sessionId)
    }

    const remaining = conversations.filter((c) => c.id !== conversationId)
    setConversations(remaining)

    if (conversationId === activeConversationId) {
      if (remaining.length > 0) {
        setActiveConversationId(remaining[0].id)
        loadConversationMessages(remaining[0])
        saveActiveSessionId(remaining[0].id)
      } else {
        handleNewConversation()
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
    flushSync(() => setCurrentMessages((prev) => prev.slice(0, lastUserIdx)))
    submitMessage(lastUserMessage.content)
  }

  function handleExportChat() {
    if (currentMessages.length === 0) {
      toast({ title: "내보낼 대화가 없습니다", description: "메시지가 생긴 뒤 다시 시도해 주세요.", variant: "destructive" })
      return
    }
    const lines: string[] = ["=== 코비전 CS Bot 대화 내보내기 ===", `내보낸 시각: ${new Date().toLocaleString("ko-KR")}`, ""]
    for (const msg of currentMessages) {
      const time = new Date(msg.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
      const sender = msg.sender === "user" ? "사용자" : (msg.title ?? "CS Bot")
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
    toast({ title: "대화를 내보냈습니다", description: fileName })
  }

  // submitMessage 완료 후 최신 메시지를 ref로 캡처해서 refreshConversations에 전달
  const latestMessagesRef = useRef<Message[]>([])

  async function submitMessage(content: string) {
    let convId = activeConversationId
    if (!convId) {
      convId = generateUUID()
      const now = new Date().toISOString()
      const newConv: Conversation = {
        id: convId,
        title: generateConversationTitle(content),
        messageCount: 0,
        messages: [],
        messagesLoaded: true,
        createdAt: now,
        updatedAt: now,
      }
      setConversations((prev) => [newConv, ...prev])
      setActiveConversationId(convId)
      saveActiveSessionId(convId)
    }

    const userMessage: Message = {
      id: generateUUID(),
      content,
      sender: "user",
      timestamp: new Date(),
    }
    const assistantMessageId = generateUUID()
    const assistantMessage: Message = {
      id: assistantMessageId,
      sender: "bot",
      timestamp: new Date(),
      title: "코비전 CS Bot",
      content: "",
      status: "searching",
      answerSource: null,
      retrievalMode: null,
      confidence: null,
      linkUrl: null,
      linkLabel: null,
      isNewMessage: true,
    }

    setCurrentMessages((prev) => {
      const next = [...prev, userMessage, assistantMessage]
      latestMessagesRef.current = next
      return next
    })

    // 제목 업데이트 (첫 메시지일 때)
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId && (c.title === "새 대화" || c.messageCount === 0)
          ? { ...c, title: generateConversationTitle(content) }
          : c
      )
    )

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: content,
          retrievalScope: "scc",
          conversationId: convId,
          userKey,
          conversationHistory: currentMessages
            .filter((m) => m.sender === "user" || (m.sender === "bot" && m.content && m.status === "matched"))
            .slice(-6)
            .map((m) => ({ role: m.sender === "user" ? "user" : "assistant", content: m.content })),
        }),
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

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
        setCurrentMessages((prev) => {
          const next = prev.map((msg) => (msg.id === assistantMessageId ? noMatchMessage : msg))
          latestMessagesRef.current = next
          return next
        })
        return
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response body")

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
              const event = JSON.parse(trimmed.slice(6))

              if (event.type === "metadata") {
                metadata = event.data
                if (typeof event.data?.logId === "string") capturedLogId = event.data.logId
                if (Array.isArray(event.data?.top3Candidates)) {
                  capturedTop3 = event.data.top3Candidates as import("@/components/chatbot/chat-message").CandidateCard[]
                }
                const earlyLinkUrl = typeof metadata?.similarIssueUrl === "string" ? metadata.similarIssueUrl : null
                setCurrentMessages((prev) => {
                  const next = prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: "답변을 생성하고 있습니다...", linkUrl: earlyLinkUrl, linkLabel: earlyLinkUrl ? "유사 이력 바로가기" : null, status: "generating" }
                      : msg
                  )
                  latestMessagesRef.current = next
                  return next
                })
              } else if (event.type === "chunk") {
                accumulatedText += event.data
                setCurrentMessages((prev) => {
                  const next = prev.map((msg) =>
                    msg.id === assistantMessageId ? { ...msg, content: accumulatedText, status: "streaming" } : msg
                  )
                  latestMessagesRef.current = next
                  return next
                })
              } else if (event.type === "done") {
                const finalLinkUrl = typeof metadata?.similarIssueUrl === "string" ? metadata.similarIssueUrl : null
                setCurrentMessages((prev) => {
                  const next = prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          content: accumulatedText,
                          ...metadata,
                          linkUrl: finalLinkUrl,
                          linkLabel: finalLinkUrl ? "유사 이력 바로가기" : null,
                          logId: capturedLogId,
                          top3Candidates: capturedTop3 ?? undefined,
                          status: "matched",
                          isNewMessage: false,
                        }
                      : msg
                  )
                  latestMessagesRef.current = next
                  return next
                })
              }
            } catch {
              // invalid JSON line 무시
            }
          }
        }
      } finally {
        reader.releaseLock()
        // 스트림 완료 후 DB에서 대화 목록 갱신 (sessionId, messageCount 동기화)
        const capturedId = convId!
        const capturedMsgs = latestMessagesRef.current
        refreshConversations(capturedId, capturedMsgs)
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
      setCurrentMessages((prev) => {
        const next = prev.map((msg) => (msg.id === assistantMessageId ? errorMessage : msg))
        latestMessagesRef.current = next
        return next
      })
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
          isTyping={isTyping || isLoadingMessages}
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
