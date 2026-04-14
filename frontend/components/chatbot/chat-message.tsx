"use client"

import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Info,
  Layers3,
  Link2,
  Maximize2,
  Pencil,
  RotateCcw,
  ScrollText,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export interface CandidateCard {
  requireId: string
  sccId: string
  score: number
  chunkType: string
  previewText: string
  linkUrl: string
}

export interface ManualCandidateCard {
  documentId: string
  chunkId: string
  score: number
  product: string
  title: string
  version?: string | null
  sectionTitle?: string | null
  previewText: string
  linkUrl?: string | null
  sourceLabel?: string | null
  previewImageUrl?: string | null
  previewImageConfidence?: "high" | "low" | null
  previewImageReason?: string | null
  previewPageNumber?: number | null
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
  manualCandidates?: ManualCandidateCard[] | null
  isNewMessage?: boolean
}

interface ChatMessageProps {
  message: Message
  onSuggestedQuestion?: (q: string) => void
  onRetry?: () => void
  onEditQuestion?: (query: string) => void
  originalQuery?: string
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
      // clipboard API unavailable
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      aria-label="답변 복사"
      title="답변 복사"
      type="button"
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
      // 실패해도 UI 상태는 유지
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
        aria-label="도움이 됐어요"
        type="button"
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
        aria-label="도움이 안 됐어요"
        type="button"
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

const ANSWER_SOURCE_LABEL: Record<string, string> = {
  llm: "LLM 답변",
  deterministic_fallback: "이력 기반",
  rule_only: "규칙 기반",
  manual: "매뉴얼 기반",
  clarification: "추가 확인 필요",
  no_match: "유사 이력 없음",
  proxy_error: "연결 오류",
}

const RETRIEVAL_MODE_LABEL: Record<string, string> = {
  hybrid: "하이브리드 검색",
  rule_only: "규칙 검색",
  manual: "매뉴얼 검색",
}

interface ParsedAnswerSection {
  title: string
  body: string
}

function getAnswerSourceLabel(answerSource: string | null | undefined): string | null {
  if (!answerSource) return null
  return ANSWER_SOURCE_LABEL[answerSource] ?? answerSource
}

function getRetrievalModeLabel(retrievalMode: string | null | undefined): string | null {
  if (!retrievalMode) return null
  return RETRIEVAL_MODE_LABEL[retrievalMode] ?? retrievalMode
}

function parseStructuredAnswerSections(content: string): ParsedAnswerSection[] {
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (!normalized) return []

  const lines = normalized.split("\n")
  const sections: ParsedAnswerSection[] = []
  let currentTitle: string | null = null
  let currentBody: string[] = []

  const flush = () => {
    if (!currentTitle) return
    const body = currentBody.join("\n").trim()
    sections.push({ title: currentTitle, body })
    currentTitle = null
    currentBody = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const headingMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/)
    if (headingMatch) {
      flush()
      currentTitle = headingMatch[2].trim()
      continue
    }

    if (!currentTitle) {
      currentTitle = "핵심 안내"
    }
    currentBody.push(line)
  }

  flush()

  if (sections.length <= 1) {
    return []
  }

  return sections.filter((section) => section.body.length > 0)
}

function getSectionTone(title: string): {
  icon: typeof Sparkles
  titleClassName: string
  cardClassName: string
} {
  const normalized = title.replace(/\s+/g, "")

  if (/핵심|요약|안내|답변/.test(normalized)) {
    return {
      icon: Sparkles,
      titleClassName: "text-primary",
      cardClassName: "border-primary/15 bg-primary/5",
    }
  }
  if (/적용|방법|절차|순서|경로/.test(normalized)) {
    return {
      icon: Layers3,
      titleClassName: "text-sky-600 dark:text-sky-300",
      cardClassName: "border-sky-500/15 bg-sky-500/5",
    }
  }
  if (/확인|포인트|체크/.test(normalized)) {
    return {
      icon: ClipboardCheck,
      titleClassName: "text-emerald-600 dark:text-emerald-300",
      cardClassName: "border-emerald-500/15 bg-emerald-500/5",
    }
  }
  if (/참고|링크|출처/.test(normalized)) {
    return {
      icon: Link2,
      titleClassName: "text-violet-600 dark:text-violet-300",
      cardClassName: "border-violet-500/15 bg-violet-500/5",
    }
  }

  return {
    icon: ScrollText,
    titleClassName: "text-foreground",
    cardClassName: "border-border bg-muted/40",
  }
}

function AnswerMetaPills({
  answerSource,
  retrievalMode,
  confidence,
}: {
  answerSource?: string | null
  retrievalMode?: string | null
  confidence?: number | null
}) {
  const sourceLabel = getAnswerSourceLabel(answerSource)
  const retrievalLabel = getRetrievalModeLabel(retrievalMode)
  const confidenceLabel =
    typeof confidence === "number" && Number.isFinite(confidence) ? `신뢰도 ${Math.round(confidence * 100)}%` : null

  if (!sourceLabel && !retrievalLabel && !confidenceLabel) return null

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {sourceLabel ? (
        <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
          {sourceLabel}
        </span>
      ) : null}
      {retrievalLabel ? (
        <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
          {retrievalLabel}
        </span>
      ) : null}
      {confidenceLabel ? (
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
          {confidenceLabel}
        </span>
      ) : null}
    </div>
  )
}

function StructuredAnswerSections({ content }: { content: string }) {
  const sections = parseStructuredAnswerSections(content)
  const [expandedTitles, setExpandedTitles] = useState<Set<string>>(
    () => new Set(sections.slice(0, 1).map((section) => section.title)),
  )

  useEffect(() => {
    if (sections.length === 0) {
      setExpandedTitles(new Set())
      return
    }

    setExpandedTitles((current) => {
      const titles = new Set(sections.map((section) => section.title))
      const next = new Set([...current].filter((title) => titles.has(title)))
      if (next.size === 0) {
        next.add(sections[0]!.title)
      }
      return next
    })
  }, [sections])

  if (sections.length === 0) {
    return <BotMessageContent content={content} />
  }

  const toggleSection = (title: string) => {
    setExpandedTitles((current) => {
      const next = new Set(current)
      if (next.has(title)) {
        next.delete(title)
      } else {
        next.add(title)
      }
      return next
    })
  }

  return (
    <div className="space-y-2.5">
      {sections.map((section, index) => {
        const tone = getSectionTone(section.title)
        const Icon = tone.icon
        const isExpanded = expandedTitles.has(section.title)

        return (
          <section key={`${section.title}-${index}`} className={cn("rounded-2xl border px-3 py-3", tone.cardClassName)}>
            <button
              type="button"
              onClick={() => toggleSection(section.title)}
              className="flex w-full items-center gap-2 text-left"
            >
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]",
                  tone.titleClassName,
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{section.title}</span>
              </div>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>
            {isExpanded ? (
              <div className="mt-2 text-sm leading-relaxed">
                <BotMessageContent content={section.body} />
              </div>
            ) : (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                {section.body.replace(/\s+/g, " ").trim()}
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}

function ManualAnswerHero({ candidate }: { candidate: ManualCandidateCard }) {
  return (
    <div className="mb-3 rounded-2xl border border-sky-500/20 bg-sky-500/6 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-sky-500/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-600 dark:text-sky-300">
              매뉴얼 기준
            </span>
            <span className="rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
              {candidate.product}
            </span>
            {typeof candidate.previewPageNumber === "number" ? (
              <span className="rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                p.{candidate.previewPageNumber}
              </span>
            ) : null}
          </div>
          <p className="truncate text-sm font-semibold text-foreground">{candidate.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {candidate.sourceLabel ?? candidate.sectionTitle ?? "관련 절차를 기준으로 안내합니다."}
          </p>
        </div>
        {candidate.linkUrl ? (
          <a
            href={candidate.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-500/20 bg-background px-3 py-1.5 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-500/10 dark:text-sky-300"
          >
            매뉴얼 열기
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

function ManualPreviewDialog({
  candidate,
  triggerClassName,
  children,
}: {
  candidate: ManualCandidateCard
  triggerClassName?: string
  children?: React.ReactNode
}) {
  if (!candidate.previewImageUrl) return null

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children ?? (
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-background px-3 py-1.5 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-500/10 dark:text-sky-300",
              triggerClassName,
            )}
          >
            크게 보기
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="truncate text-base">{candidate.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span>{candidate.sourceLabel ?? candidate.sectionTitle ?? "매뉴얼 화면 미리보기"}</span>
            {typeof candidate.previewPageNumber === "number" ? <span>p.{candidate.previewPageNumber}</span> : null}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-auto bg-black/90 p-4">
          <img
            src={candidate.previewImageUrl}
            alt={`${candidate.title} 매뉴얼 확대 미리보기`}
            className="mx-auto max-h-[calc(90dvh-8rem)] w-auto max-w-full rounded-xl bg-white object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SuggestedQuestions({ candidates, onSelect }: { candidates: CandidateCard[]; onSelect: (q: string) => void }) {
  const suggestions = candidates
    .slice(1, 3)
    .map((candidate) => {
      const firstLine = candidate.previewText.split("\n")[0].trim()
      return firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine
    })
    .filter((text) => text.length > 0)

  if (suggestions.length === 0) return null

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">관련 질문</p>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
        {suggestions.map((text, index) => (
          <button
            key={index}
            onClick={() => onSelect(text)}
            className="shrink-0 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
            type="button"
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
      <button
        onClick={() => setIsExpanded((value) => !value)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        type="button"
      >
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        유사 이력 {candidates.length}건
        {!isExpanded && <span className="text-[10px] opacity-60">펼쳐보기</span>}
      </button>

      {isExpanded && (
        <div className="mt-2 flex flex-col gap-2">
          {candidates.map((candidate, index) => (
            <a
              key={candidate.requireId}
              href={candidate.linkUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-3 text-xs transition-colors hover:bg-muted"
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">SCC {candidate.sccId}</span>
                  <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                    {CHUNK_TYPE_LABEL[candidate.chunkType] ?? candidate.chunkType}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {Math.round(candidate.score * 100)}%
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground">{candidate.previewText}</p>
              </div>
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function ManualCandidateCards({ candidates }: { candidates: ManualCandidateCard[] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [hiddenPreviewIds, setHiddenPreviewIds] = useState<Set<string>>(new Set())

  if (candidates.length === 0) return null

  return (
    <div className="mt-3">
      <button
        onClick={() => setIsExpanded((value) => !value)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        type="button"
      >
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        참고 매뉴얼 {candidates.length}건
        {!isExpanded && <span className="text-[10px] opacity-60">펼쳐보기</span>}
      </button>

      {isExpanded && (
        <div className="mt-2 flex flex-col gap-2">
          {candidates.map((candidate, index) => {
            const content = (
              <>
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-[10px] font-bold text-sky-500">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-foreground">{candidate.title}</span>
                    <span className="rounded bg-sky-500/10 px-1 py-0.5 text-[10px] text-sky-500">
                      {candidate.product}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {Math.round(candidate.score * 100)}%
                    </span>
                  </div>
                  {candidate.sourceLabel ? (
                    <p className="mt-0.5 truncate text-[10px] text-sky-600 dark:text-sky-300">
                      출처: {candidate.sourceLabel}
                    </p>
                  ) : null}
                  {candidate.sectionTitle ? (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{candidate.sectionTitle}</p>
                  ) : null}
                  {candidate.previewImageUrl && !hiddenPreviewIds.has(candidate.chunkId) ? (
                    <ManualPreviewDialog candidate={candidate}>
                      <button type="button" className="mt-2 block w-full text-left">
                        <img
                          src={candidate.previewImageUrl}
                          alt={`${candidate.title} 매뉴얼 미리보기`}
                          className="max-h-40 w-full rounded-xl border border-border object-contain bg-background"
                          loading="lazy"
                          onError={() =>
                            setHiddenPreviewIds((current) => {
                              const next = new Set(current)
                              next.add(candidate.chunkId)
                              return next
                            })
                          }
                        />
                      </button>
                    </ManualPreviewDialog>
                  ) : null}
                  <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground">{candidate.previewText}</p>
                </div>
                {candidate.linkUrl ? (
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                ) : null}
              </>
            )

            return candidate.linkUrl ? (
              <a
                key={candidate.chunkId}
                href={candidate.linkUrl}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-2 rounded-xl border border-border bg-sky-500/5 px-3 py-3 text-xs transition-colors hover:bg-sky-500/10"
              >
                {content}
              </a>
            ) : (
              <div
                key={candidate.chunkId}
                className="group flex items-start gap-2 rounded-xl border border-border bg-sky-500/5 px-3 py-3 text-xs"
              >
                {content}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ManualPreviewCallout({ candidate }: { candidate: ManualCandidateCard }) {
  const [isHidden, setIsHidden] = useState(false)

  if (!candidate.previewImageUrl || isHidden) return null

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-sky-500/25 bg-sky-500/5">
      <div className="flex items-center justify-between gap-3 border-b border-sky-500/15 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-sky-600 dark:text-sky-300">화면 미리보기</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {candidate.sourceLabel ?? candidate.sectionTitle ?? candidate.title}
          </p>
        </div>
        {candidate.linkUrl ? (
          <div className="flex shrink-0 items-center gap-2">
            <ManualPreviewDialog candidate={candidate} triggerClassName="hidden sm:inline-flex" />
            <a
              href={candidate.linkUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-600 transition-colors hover:bg-sky-500/20 dark:text-sky-300"
            >
              원문 열기
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <ManualPreviewDialog candidate={candidate} triggerClassName="hidden sm:inline-flex" />
        )}
      </div>
      <div className="bg-background/70 p-2">
        <ManualPreviewDialog candidate={candidate}>
          <button
            type="button"
            className="block w-full transition-colors hover:bg-background"
            title="미리보기 이미지를 크게 보기"
          >
            <img
              src={candidate.previewImageUrl}
              alt={`${candidate.title} 매뉴얼 화면 미리보기`}
              className="max-h-72 w-full rounded-lg object-contain"
              loading="lazy"
              onError={() => setIsHidden(true)}
            />
          </button>
        </ManualPreviewDialog>
      </div>
      <div className="border-t border-sky-500/15 px-3 py-2 text-[10px] text-muted-foreground">
        {candidate.previewImageConfidence === "high"
          ? "질문과 가까운 화면을 우선 노출합니다."
          : candidate.previewImageReason ?? "미리보기 이미지는 참고용으로 제공됩니다."}
      </div>
    </div>
  )
}

export function ChatMessage({ message, onSuggestedQuestion, onRetry, onEditQuestion, originalQuery }: ChatMessageProps) {
  const isUser = message.sender === "user"
  const isNoMatch = !isUser && message.answerSource === "no_match"
  const isSecurityBlocked = !isUser && message.status === "SECURITY_BLOCKED"
  const isSearching = !isUser && message.status === "searching"
  const isGenerating = !isUser && !isSearching && (!message.content || message.status === "generating")
  const isManualAnswer = !isUser && message.answerSource === "manual"

  const contentToDisplay = message.content
  const isError = !isUser && message.status === "error"
  const canRetry = isError && onRetry != null
  const canEditQuestion = isNoMatch && onEditQuestion != null && originalQuery != null
  const showActions = !isUser && !isNoMatch && !isSecurityBlocked && !isGenerating && !isSearching
  const showCandidates = showActions && Array.isArray(message.top3Candidates) && message.top3Candidates.length > 1
  const showManualCandidates =
    showActions && isManualAnswer && Array.isArray(message.manualCandidates) && message.manualCandidates.length > 0
  const primaryManualCandidate = showManualCandidates ? message.manualCandidates?.[0] ?? null : null
  const primaryManualPreviewCandidate = showManualCandidates
    ? message.manualCandidates!.find((candidate) => Boolean(candidate.previewImageUrl)) ?? null
    : null
  const showSuggestions = showCandidates && onSuggestedQuestion != null

  return (
    <div className={cn("flex gap-2.5 md:gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full md:h-9 md:w-9",
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

      <div className="flex max-w-[85%] flex-col gap-1 md:max-w-[78%]">
        <div
          className={cn(
            "rounded-2xl px-3.5 py-3 text-sm leading-relaxed shadow-sm md:px-4",
            isUser
              ? "rounded-tr-sm bg-muted text-foreground"
              : isSecurityBlocked
                ? "rounded-tl-sm border border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                : isNoMatch
                  ? "rounded-tl-sm border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                  : "rounded-tl-sm border border-border bg-card text-card-foreground",
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

          {isSearching ? (
            <div className="rounded-2xl border border-primary/15 bg-primary/5 px-3 py-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                <span className="text-xs">유사 이력을 검색하고 있습니다...</span>
              </div>
            </div>
          ) : isGenerating ? (
            <div className="rounded-2xl border border-primary/15 bg-primary/5 px-3 py-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                <span className="text-xs">답변을 생성하고 있습니다...</span>
              </div>
            </div>
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words">{contentToDisplay}</p>
          ) : (
            <>
              <AnswerMetaPills
                answerSource={message.answerSource}
                retrievalMode={message.retrievalMode}
                confidence={message.confidence}
              />
              {primaryManualCandidate ? <ManualAnswerHero candidate={primaryManualCandidate} /> : null}
              <StructuredAnswerSections content={contentToDisplay} />
            </>
          )}

          {!isUser && message.linkUrl ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={message.linkUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                {message.linkLabel ?? "유사 이력 바로가기"}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {isManualAnswer &&
              primaryManualCandidate?.linkUrl &&
              primaryManualCandidate.linkUrl !== message.linkUrl ? (
                <a
                  href={primaryManualCandidate.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/15 dark:text-sky-300"
                >
                  원문 매뉴얼 열기
                  <BookOpen className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          ) : null}

          {primaryManualPreviewCandidate ? <ManualPreviewCallout candidate={primaryManualPreviewCandidate} /> : null}
          {showCandidates && <CandidateCards candidates={message.top3Candidates!} />}
          {showManualCandidates && <ManualCandidateCards candidates={message.manualCandidates!} />}
          {showSuggestions && <SuggestedQuestions candidates={message.top3Candidates!} onSelect={onSuggestedQuestion!} />}
        </div>

        <div className={cn("flex items-center gap-1.5 px-1", isUser ? "flex-row-reverse" : "flex-row")}>
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(message.timestamp)}</span>
          {showActions && <CopyButton text={contentToDisplay} />}
          {showActions && message.logId && <FeedbackButtons logId={message.logId} />}
          {canRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="다시 시도"
              aria-label="메시지 다시 시도"
              type="button"
            >
              <RotateCcw className="h-3 w-3" />
              다시 시도
            </button>
          )}
          {canEditQuestion && (
            <button
              onClick={() => onEditQuestion(originalQuery)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="입력창에 질문 불러오기"
              aria-label="질문 수정하기"
              type="button"
            >
              <Pencil className="h-3 w-3" />
              질문 수정하기
            </button>
          )}
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
