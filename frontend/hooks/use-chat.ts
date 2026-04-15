import { useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import type { CandidateCard, ManualCandidateCard, Message } from "@/components/chatbot/chat-message"
import { toast } from "@/hooks/use-toast"
import {
  exportChatMessages,
  getChatExportFormatLabel,
  getChatExportScopeLabel,
  getChatExportTemplateLabel,
  type ChatExportFormat,
  type ChatExportRequest,
} from "@/lib/chat-export"

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

const quickFallbackAnswer =
  "현재 AI Core 응답을 가져오지 못했습니다. 잠시 후 다시 시도하시거나, 구체적인 오류 문구와 화면 경로를 함께 입력해 주세요."

export function useChat(args: {
  activeConversationId: string | null
  currentMessages: Message[]
  setCurrentMessages: React.Dispatch<React.SetStateAction<Message[]>>
  ensureConversation: (firstMessage?: string) => string
  browserUserKey: string | null
}) {
  const { activeConversationId, currentMessages, setCurrentMessages, ensureConversation, browserUserKey } = args

  const [isTyping, setIsTyping] = useState(false)
  const [inputPrefill, setInputPrefill] = useState<{ value: string; seq: number } | undefined>(undefined)
  const pendingTextRef = useRef("")
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushAssistantText = useCallback(
    (assistantMessageId: string, status: string = "streaming") => {
      const nextText = pendingTextRef.current
      setCurrentMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, content: nextText, status } : msg,
        ),
      )
    },
    [setCurrentMessages],
  )

  const scheduleAssistantFlush = useCallback(
    (assistantMessageId: string) => {
      if (flushTimerRef.current) {
        return
      }
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null
        flushAssistantText(assistantMessageId)
      }, 80)
    },
    [flushAssistantText],
  )

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
      }
    }
  }, [])

  const handleEditQuestion = useCallback((query: string) => {
    setInputPrefill((prev) => ({ value: query, seq: (prev?.seq ?? 0) + 1 }))
  }, [])

  const handleRetry = useCallback(() => {
    const lastUserMessage = [...currentMessages].reverse().find((m) => m.sender === "user")
    if (!lastUserMessage) return

    const lastUserIdx = currentMessages
      .map((_, i) => i)
      .filter((i) => currentMessages[i].sender === "user")
      .pop()
    if (lastUserIdx === undefined) return

    flushSync(() => {
      setCurrentMessages((prev) => prev.slice(0, lastUserIdx))
    })
    void submitMessage(lastUserMessage.content)
  }, [currentMessages, setCurrentMessages])

  const handleExportChat = useCallback((request: ChatExportRequest = { format: "txt", template: "user" }) => {
    if (currentMessages.length === 0) {
      toast({
        title: "\uB0B4\uBCF4\uB0BC \uB300\uD654\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
        description: "\uBA54\uC2DC\uC9C0\uAC00 \uC313\uC778 \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
        variant: "destructive",
      })
      return
    }

    try {
      const format: ChatExportFormat = request.format
      const template = request.template ?? "user"
      const scope = request.scope ?? (template === "report" ? "latest_exchange" : "all")
      const result = exportChatMessages(currentMessages, request)
      const label = `${getChatExportTemplateLabel(template)} ${getChatExportFormatLabel(format)}`
      const scopeLabel = getChatExportScopeLabel(scope)
      toast({
        title:
          format === "pdf"
            ? "PDF \uC778\uC1C4 \uD654\uBA74\uC744 \uC5F4\uC5C8\uC2B5\uB2C8\uB2E4"
            : "\uB300\uD654\uB97C \uB0B4\uBCF4\uB0C8\uC2B5\uB2C8\uB2E4",
        description: format === "pdf" ? `${label} · ${scopeLabel}` : `${label} · ${scopeLabel}: ${result}`,
      })
    } catch (error) {
      toast({
        title: "\uB300\uD654 \uB0B4\uBCF4\uB0B4\uAE30\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4",
        description:
          error instanceof Error ? error.message : "\uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
        variant: "destructive",
      })
    }
  }, [currentMessages])

  async function submitMessage(content: string) {
    const convId = activeConversationId ?? ensureConversation(content)

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

    const historyForRequest = currentMessages
      .filter((m) => m.sender === "user" || (m.sender === "bot" && m.content && m.status === "matched"))
      .slice(-6)
      .map((m) => ({ role: m.sender === "user" ? "user" : "assistant", content: m.content }))

    setCurrentMessages((prev) => [...prev, assistantMessage])
    setIsTyping(false)
    pendingTextRef.current = ""

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: content,
          retrievalScope: "all",
          conversationId: convId,
          userKey: browserUserKey ?? undefined,
          conversationHistory: historyForRequest,
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
          title: isSecurityBlocked ? "보안 정책" : "유사 이력 없음",
          content: jsonData.message || "관련 처리 이력을 찾지 못했습니다.\n\n구체적인 증상이나 메뉴명을 포함해서 다시 질문해 주세요.",
          status: jsonData.error || "no_match",
          answerSource: "no_match",
        }
        setCurrentMessages((prev) => prev.map((msg) => (msg.id === assistantMessageId ? noMatchMessage : msg)))
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error("No response body")
      }

      const decoder = new TextDecoder()
      let buffer = ""
      let metadata: Record<string, unknown> | null = null
      let capturedLogId: string | null = null
      let capturedTop3: CandidateCard[] | null = null
      let capturedManualCandidates: ManualCandidateCard[] | null = null

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
                  capturedTop3 = event.data.top3Candidates as CandidateCard[]
                }
                if (Array.isArray(event.data?.manualCandidates)) {
                  capturedManualCandidates = event.data.manualCandidates as ManualCandidateCard[]
                }
                const earlyLinkUrl = typeof metadata?.similarIssueUrl === "string" ? metadata.similarIssueUrl : null
                const earlyLinkLabel =
                  earlyLinkUrl && typeof metadata?.linkLabel === "string" ? metadata.linkLabel : earlyLinkUrl ? "유사 이력 바로가기" : null
                setCurrentMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          content: pendingTextRef.current || "답변을 생성하고 있습니다...",
                          linkUrl: earlyLinkUrl,
                          linkLabel: earlyLinkLabel,
                          status: "generating",
                        }
                      : msg,
                  ),
                )
              } else if (event.type === "chunk") {
                pendingTextRef.current += event.data
                scheduleAssistantFlush(assistantMessageId)
              } else if (event.type === "done") {
                if (flushTimerRef.current) {
                  clearTimeout(flushTimerRef.current)
                  flushTimerRef.current = null
                }
                const finalText = pendingTextRef.current
                const finalLinkUrl = typeof metadata?.similarIssueUrl === "string" ? metadata.similarIssueUrl : null
                const finalLinkLabel =
                  finalLinkUrl && typeof metadata?.linkLabel === "string" ? metadata.linkLabel : finalLinkUrl ? "유사 이력 바로가기" : null
                setCurrentMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          content: finalText,
                          ...metadata,
                          linkUrl: finalLinkUrl,
                          linkLabel: finalLinkLabel,
                          logId: capturedLogId,
                          top3Candidates: capturedTop3 ?? undefined,
                          manualCandidates: capturedManualCandidates ?? undefined,
                          status: "matched",
                          isNewMessage: false,
                        }
                      : msg,
                  ),
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
      setCurrentMessages((prev) => prev.map((msg) => (msg.id === assistantMessageId ? errorMessage : msg)))
    } finally {
      setIsTyping(false)
      pendingTextRef.current = ""
    }
  }

  return {
    isTyping,
    inputPrefill,
    setInputPrefill,
    submitMessage,
    handleRetry,
    handleEditQuestion,
    handleExportChat,
  }
}

