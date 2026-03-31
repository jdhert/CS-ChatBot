"use client"

import { Bot, Check, ChevronDown, ChevronUp, Copy, ExternalLink, Info, ShieldAlert, ThumbsDown, ThumbsUp, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTypingEffect } from "@/hooks/use-typing-effect"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useState } from "react"

export interface CandidateCard {
  requireId: string
  sccId: string
  score: number
  chunkType: string
  previewText: string
  linkUrl: string
}

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
  top3Candidates?: CandidateCard[] | null
  isNewMessage?: boolean
}

interface ChatMessageProps {
  message: Message
  onSuggestedQuestion?: (q: string) => void
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
          <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:opacity-80">
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API 미지원 환경 무시
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      aria-label="답변 복사"
      title="답변 복사"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
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
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground">도움이 됐나요?</span>
      <button
        onClick={() => handleVote("up")}
        disabled={voted !== null}
        className={cn(
          "rounded p-0.5 transition-colors",
          voted === "up" ? "text-green-500" : "text-muted-foreground hover:text-green-500 disabled:opacity-40",
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
          voted === "down" ? "text-red-500" : "text-muted-foreground hover:text-red-500 disabled:opacity-40",
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

const CHUNK_TYPE_LABEL: Record<string, string> = {
  issue: "증상",
  action: "조치",
  resolution: "처리",
  qa_pair: "Q&A",
}

function SuggestedQuestions({ candidates, onSelect }: { candidates: CandidateCard[]; onSelect: (q: string) => void }) {
  // top1은 링크 버튼으로 이미 표시되므로 index 1, 2만 사용
  const suggestions = candidates
    .slice(1, 3)
    .map((c) => {
      const firstLine = c.previewText.split("\n")[0].trim()
      return firstLine.length > 42 ? firstLine.slice(0, 42) + "…" : firstLine
    })
    .filter((t) => t.length > 0)

  if (suggestions.length === 0) return null

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">관련 질문</p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((text, i) => (
          <button
            key={i}
            onClick={() => onSelect(text)}
            className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-foreground transition-colors hover:bg-primary/10 hover:border-primary/50"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function CandidateCards({ candidates }: { candidates: CandidateCard[] }) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (candidates.length === 0) return null

  return (
    <div className="mt-3">
      {/* 토글 버튼 */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {isExpanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        유사 이력 {candidates.length}건
        {!isExpanded && <span className="text-[10px] opacity-60">— 더 보기</span>}
      </button>

      {/* 카드 목록 (펼쳐진 경우만) */}
      {isExpanded && (
        <div className="mt-2 flex flex-col gap-1.5">
          {candidates.map((c, i) => (
            <a
              key={c.requireId}
              href={c.linkUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs transition-colors hover:bg-muted"
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">SCC {c.sccId}</span>
                  <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                    {CHUNK_TYPE_LABEL[c.chunkType] ?? c.chunkType}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {Math.round(c.score * 100)}%
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground">{c.previewText}</p>
              </div>
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatMessage({ message, onSuggestedQuestion }: ChatMessageProps) {
  const isUser = message.sender === "user"
  const isNoMatch = !isUser && message.answerSource === "no_match"
  const isSecurityBlocked = !isUser && message.status === "SECURITY_BLOCKED"
  const isSearching = !isUser && message.status === "searching"
  const isGenerating = !isUser && (!isSearching && (!message.content || message.status === "generating"))

  const shouldShowTypingEffect = false
  const { displayedText } = useTypingEffect({
    text: message.content,
    speed: 8,
    enabled: shouldShowTypingEffect,
  })

  const contentToDisplay = message.content
  const showActions = !isUser && !isNoMatch && !isSecurityBlocked && !isGenerating && !isSearching
  const showCandidates =
    showActions &&
    Array.isArray(message.top3Candidates) &&
    message.top3Candidates.length > 1  // Top1만 있으면 이미 링크 버튼으로 표시됨
  const showSuggestions = showCandidates && onSuggestedQuestion != null

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
          {/* 제목 */}
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

          {/* 본문 */}
          {isSearching ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
              <span className="text-xs">유사 이력을 검색하고 있습니다...</span>
            </div>
          ) : isGenerating ? (
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

          {/* Top1 링크 버튼 */}
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

          {/* Top3 유사 이력 카드 */}
          {showCandidates && <CandidateCards candidates={message.top3Candidates!} />}

          {/* 관련 질문 추천 chips */}
          {showSuggestions && (
            <SuggestedQuestions candidates={message.top3Candidates!} onSelect={onSuggestedQuestion!} />
          )}
        </div>

        {/* 타임스탬프 + 복사 + 피드백 */}
        <div className={cn("flex items-center gap-1.5 px-1", isUser ? "flex-row-reverse" : "flex-row")}>
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(message.timestamp)}</span>
          {showActions && <CopyButton text={contentToDisplay} />}
          {showActions && message.logId && <FeedbackButtons logId={message.logId} />}
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
