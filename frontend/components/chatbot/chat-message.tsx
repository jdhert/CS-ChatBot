"use client"

import { Bot, ExternalLink, Info, ShieldAlert, ThumbsDown, ThumbsUp, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTypingEffect } from "@/hooks/use-typing-effect"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useState } from "react"

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
  logId?: string | null
  isNewMessage?: boolean
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

async function submitFeedback(logId: string, feedback: "up" | "down"): Promise<void> {
  await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logId, feedback }),
  })
}

function BotMessageContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1 last:mb-0 whitespace-pre-wrap break-words">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        h1: ({ children }) => <h1 className="mb-1 text-sm font-bold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1 text-sm font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-0.5 text-sm font-semibold">{children}</h3>,
        ul: ({ children }) => <ul className="mb-1 ml-4 list-disc space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="mb-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="break-words">{children}</li>,
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="mb-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{children}</pre>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-2 border-border" />,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function FeedbackButtons({ logId }: { logId: string }) {
  const [voted, setVoted] = useState<"up" | "down" | null>(null)

  async function handleVote(feedback: "up" | "down") {
    if (voted !== null) return
    setVoted(feedback)
    try {
      await submitFeedback(logId, feedback)
    } catch {
      // 실패해도 UI 상태는 유지 (fire-and-forget)
    }
  }

  return (
    <div className="mt-1.5 flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground">도움이 됐나요?</span>
      <button
        onClick={() => handleVote("up")}
        disabled={voted !== null}
        className={cn(
          "rounded p-0.5 transition-colors",
          voted === "up"
            ? "text-green-500"
            : "text-muted-foreground hover:text-green-500 disabled:opacity-40",
        )}
        aria-label="도움됨"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => handleVote("down")}
        disabled={voted !== null}
        className={cn(
          "rounded p-0.5 transition-colors",
          voted === "down"
            ? "text-red-500"
            : "text-muted-foreground hover:text-red-500 disabled:opacity-40",
        )}
        aria-label="도움 안됨"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      {voted && (
        <span className="text-[10px] text-muted-foreground">
          {voted === "up" ? "감사합니다 👍" : "피드백 감사합니다"}
        </span>
      )}
    </div>
  )
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.sender === "user"
  const isNoMatch = !isUser && message.answerSource === "no_match"
  const isSecurityBlocked = !isUser && message.status === "SECURITY_BLOCKED"

  const shouldShowTypingEffect = false
  const { displayedText } = useTypingEffect({
    text: message.content,
    speed: 8,
    enabled: shouldShowTypingEffect,
  })

  const contentToDisplay = isUser ? message.content : message.content
  const showFeedback = !isUser && !isNoMatch && !isSecurityBlocked && !!message.logId

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-muted text-muted-foreground"
            : isSecurityBlocked
              ? "bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400"
              : isNoMatch
                ? "bg-amber-100 text-amber-500 dark:bg-amber-900/30 dark:text-amber-400"
                : "bg-gradient-to-br from-primary to-blue-400 text-white shadow-md",
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : isSecurityBlocked ? (
          <ShieldAlert className="h-4 w-4" />
        ) : isNoMatch ? (
          <Info className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      <div className="flex max-w-[78%] flex-col gap-1">
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
            isUser
              ? "rounded-tr-sm bg-muted text-foreground"
              : isSecurityBlocked
                ? "rounded-tl-sm border border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                : isNoMatch
                  ? "rounded-tl-sm border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                  : "rounded-tl-sm bg-card text-card-foreground border border-border",
          )}
        >
          {!isUser && message.title ? (
            <div
              className={cn(
                "mb-2 text-xs font-semibold uppercase tracking-[0.08em]",
                isSecurityBlocked
                  ? "text-red-500 dark:text-red-400"
                  : isNoMatch
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-primary",
              )}
            >
              {message.title}
            </div>
          ) : null}

          {!isUser && (!contentToDisplay || message.status === "generating") ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
              <span className="text-xs">답변을 생성하고 있습니다...</span>
            </div>
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words">{contentToDisplay}</p>
          ) : (
            <BotMessageContent content={contentToDisplay} />
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
        </div>

        <div className={cn("flex flex-col px-1", isUser ? "items-end" : "items-start")}>
          <span className="text-[10px] text-muted-foreground">
            {formatTimestamp(message.timestamp)}
          </span>
          {showFeedback && <FeedbackButtons logId={message.logId!} />}
        </div>
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
