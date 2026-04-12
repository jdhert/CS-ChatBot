"use client"

import { useEffect, useRef } from "react"
import { ChatHeader } from "./chat-header"
import { ChatInput } from "./chat-input"
import { ChatMessage, TypingIndicator, type Message } from "./chat-message"
import { QuickActions } from "./quick-actions"
import type { ChatExportFormat } from "@/lib/chat-export"

interface ChatAreaProps {
  messages: Message[]
  isTyping: boolean
  isDarkMode: boolean
  onToggleDarkMode: () => void
  onSendMessage: (message: string) => void
  onExportChat?: (format: ChatExportFormat) => void
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      <ChatHeader
        isDarkMode={isDarkMode}
        onToggleDarkMode={onToggleDarkMode}
        onExportChat={onExportChat}
        onOpenSidebar={onOpenSidebar}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-blue-400 text-white shadow-xl">
                <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h2 className="mb-2 text-xl font-semibold text-foreground">코비전 CS Bot</h2>
              <p className="mb-6 max-w-md text-sm leading-relaxed text-muted-foreground">
                증상이나 오류 메시지를 입력하면 유사 처리 이력과 안내 답변을 함께 찾아드립니다.
              </p>
            </div>
          )}

          {messages.length === 0 && <QuickActions onSelect={onSendMessage} />}

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

          {isTyping && <TypingIndicator />}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <ChatInput onSend={onSendMessage} disabled={isTyping} prefill={inputPrefill} />
    </div>
  )
}
