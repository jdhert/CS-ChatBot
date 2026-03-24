"use client"

import { Bot, ExternalLink, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTypingEffect } from "@/hooks/use-typing-effect"

export interface Message {
  id: string
  content: string
  sender: "user" | "bot"
  timestamp: Date | string
  title?: string
  status?: string | null
  answerSource?: string | null
  retrievalMode?: string | null
  confidence?: number | null
  linkUrl?: string | null
  linkLabel?: string | null
  isNewMessage?: boolean // 새로 생성된 메시지인지 여부 (스트리밍 타이핑 효과용)
}

interface ChatMessageProps {
  message: Message
}

function formatTimestamp(timestamp: Date | string): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.sender === "user"

  // 스트리밍 메시지는 타이핑 효과 없이 실시간으로 표시 (더 자연스러운 스트리밍 경험)
  // isNewMessage가 true면 스트리밍 중이므로 타이핑 효과 비활성화
  const shouldShowTypingEffect = false // 스트리밍 중에는 타이핑 효과 사용 안함
  const { displayedText } = useTypingEffect({
    text: message.content,
    speed: 8, // 8ms per character
    enabled: shouldShowTypingEffect,
  })

  // 스트리밍 메시지의 실제 표시 텍스트 (타이핑 효과 없이 직접 표시)
  const contentToDisplay = isUser ? message.content : message.content

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-muted text-muted-foreground"
            : "bg-gradient-to-br from-primary to-blue-400 text-white shadow-md",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div className="flex max-w-[78%] flex-col gap-1">
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
            isUser
              ? "rounded-tr-sm bg-muted text-foreground"
              : "rounded-tl-sm bg-card text-card-foreground border border-border",
          )}
        >
          {!isUser && message.title ? (
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              {message.title}
            </div>
          ) : null}

          {!isUser && !contentToDisplay ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
              <span className="text-xs">답변을 생성하고 있습니다...</span>
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{contentToDisplay}</p>
          )}

          {!isUser && message.linkUrl ? (
            <a
              href={message.linkUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {message.linkLabel ?? "유사 이력 바로가기"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}

          {!isUser &&
          (message.status || message.answerSource || message.retrievalMode || typeof message.confidence === "number") ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.status ? (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                  status: {message.status}
                </span>
              ) : null}
              {message.answerSource ? (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                  source: {message.answerSource}
                </span>
              ) : null}
              {message.retrievalMode ? (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                  retrieval: {message.retrievalMode}
                </span>
              ) : null}
              {typeof message.confidence === "number" ? (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                  confidence: {message.confidence}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <span className={cn("px-1 text-[10px] text-muted-foreground", isUser ? "text-right" : "text-left")}>
          {formatTimestamp(message.timestamp)}
        </span>
      </div>
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-400 text-white shadow-md">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 shadow-sm">
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
      </div>
    </div>
  )
}
