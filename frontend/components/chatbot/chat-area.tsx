"use client"

import { ArrowDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { ChatHeader } from "./chat-header"
import { ChatInput } from "./chat-input"
import { ChatMessage, TypingIndicator, type Message } from "./chat-message"
import { QuickActions } from "./quick-actions"
import { cn } from "@/lib/utils"
import type { ChatExportRequest } from "@/lib/chat-export"

interface ChatAreaProps {
  messages: Message[]
  isTyping: boolean
  isDarkMode: boolean
  onToggleDarkMode: () => void
  onSendMessage: (message: string) => void
  onExportChat?: (request: ChatExportRequest) => void
  onRetry?: () => void
  onOpenSidebar?: () => void
  onEditQuestion?: (query: string) => void
  inputPrefill?: { value: string; seq: number }
}

export function ChatArea({
  messages,
  isTyping,
  isDarkMode,
  onToggleDarkMode,
  onSendMessage,
  onExportChat,
  onRetry,
  onOpenSidebar,
  onEditQuestion,
  inputPrefill,
}: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const recentQuestions = Array.from(
    new Set(
      [...messages]
        .reverse()
        .filter((message) => message.sender === "user")
        .map((message) => message.content.trim())
        .filter((content) => content.length > 0),
    ),
  ).slice(0, 3)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowScrollToBottom(distanceFromBottom > 160)
    }

    handleScroll()
    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ChatHeader
        isDarkMode={isDarkMode}
        onToggleDarkMode={onToggleDarkMode}
        onExportChat={onExportChat}
        onOpenSidebar={onOpenSidebar}
      />

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-4 px-4 py-5 md:p-6">
          {messages.length === 0 ? (
            <>
              <div className="flex flex-col items-center justify-center py-8 text-center md:py-12">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-primary to-blue-400 text-white shadow-xl">
                  <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <div className="rounded-3xl border border-border/70 bg-card/80 px-5 py-5 shadow-sm backdrop-blur">
                  <h2 className="mb-2 text-xl font-semibold text-foreground">코비전 CS Bot</h2>
                  <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                    증상이나 오류 메시지, 메뉴명과 매뉴얼 기준 작업명을 입력하면
                    <br className="hidden md:block" /> 유사 처리 이력과 매뉴얼 안내를 함께 찾아드립니다.
                  </p>
                </div>
              </div>

              <QuickActions onSelect={onSendMessage} />
            </>
          ) : null}

          {messages.map((message, index) => {
            const isLastBotMessage =
              message.sender === "bot" &&
              messages.slice(index + 1).every((nextMessage) => nextMessage.sender !== "bot")
            const precedingUserQuery =
              message.sender === "bot"
                ? [...messages.slice(0, index)].reverse().find((candidate) => candidate.sender === "user")?.content
                : undefined

            return (
              <ChatMessage
                key={message.id}
                message={message}
                onSuggestedQuestion={onSendMessage}
                onRetry={isLastBotMessage ? onRetry : undefined}
                onEditQuestion={isLastBotMessage ? onEditQuestion : undefined}
                originalQuery={precedingUserQuery}
              />
            )
          })}

          {isTyping ? <TypingIndicator /> : null}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center px-4 transition-all md:bottom-24",
          showScrollToBottom ? "opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        <button
          type="button"
          onClick={scrollToBottom}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          최신 응답으로 이동
        </button>
      </div>

      <ChatInput
        onSend={onSendMessage}
        disabled={isTyping}
        prefill={inputPrefill}
        recentQuestions={recentQuestions}
      />
    </div>
  )
}
