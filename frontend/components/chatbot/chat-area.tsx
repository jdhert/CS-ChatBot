"use client"

import { useEffect, useRef } from "react"
import { ChatHeader } from "./chat-header"
import { ChatInput } from "./chat-input"
import { ChatMessage, TypingIndicator, type Message } from "./chat-message"
import { QuickActions } from "./quick-actions"

interface ChatAreaProps {
  messages: Message[]
  isTyping: boolean
  isDarkMode: boolean
  onToggleDarkMode: () => void
  onSendMessage: (message: string) => void
  onExportChat?: () => void
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
      <ChatHeader isDarkMode={isDarkMode} onToggleDarkMode={onToggleDarkMode} onExportChat={onExportChat} onOpenSidebar={onOpenSidebar} />

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-6">
          {messages.length === 0 && <QuickActions onSelect={onSendMessage} />}

          {messages.map((message, idx) => {
            const isLastBotMessage =
              message.sender === "bot" &&
              messages.slice(idx + 1).every((m) => m.sender !== "bot")
            const precedingUserQuery =
              message.sender === "bot"
                ? [...messages.slice(0, idx)].reverse().find((m) => m.sender === "user")?.content
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
