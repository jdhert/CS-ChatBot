"use client"

import { useMemo, useState } from "react"
import { ExternalLink, History, RotateCcw, Search, Trash2 } from "lucide-react"

export interface HistoryItem {
  id: string
  query: string
  answerText: string
  title: string
  createdAt: string
  linkUrl?: string | null
  linkLabel?: string | null
  status?: string | null
  answerSource?: string | null
  retrievalMode?: string | null
  confidence?: number | null
}

interface HistoryPanelProps {
  items: HistoryItem[]
  onReplay: (query: string) => void
  onClear: () => void
}

type StatusFilter = "all" | "matched" | "needs_more_info" | "error"

const filterOptions: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "전체" },
  { key: "matched", label: "매치됨" },
  { key: "needs_more_info", label: "추가 확인 필요" },
  { key: "error", label: "오류" },
]

function formatDateTime(value: string): string {
  const date = new Date(value)
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function truncate(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

export function HistoryPanel({ items, onReplay, onClear }: HistoryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const filteredItems = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()

    return items.filter((item) => {
      const statusMatched = statusFilter === "all" || item.status === statusFilter
      if (!statusMatched) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      const haystack = [item.query, item.answerText, item.title, item.answerSource ?? "", item.retrievalMode ?? ""]
        .join(" ")
        .toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [items, searchQuery, statusFilter])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-primary shadow-sm">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">질문 이력</h1>
            <p className="text-xs text-muted-foreground">브라우저 로컬에 저장된 최근 질문과 답변 목록입니다.</p>
          </div>
        </div>
        <button
          onClick={onClear}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          type="button"
        >
          <Trash2 className="h-4 w-4" />
          이력 비우기
        </button>
      </div>

      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="질문, 답변, source, retrieval mode 검색"
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {filterOptions.map((option) => (
              <button
                key={option.key}
                onClick={() => setStatusFilter(option.key)}
                className={
                  statusFilter === option.key
                    ? "rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    : "rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                }
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {filteredItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <History className="mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="mb-2 text-lg font-semibold text-foreground">조건에 맞는 질문 이력이 없습니다.</h2>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              채팅 화면에서 질문을 보내면 최근 질문과 답변이 자동으로 저장됩니다.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredItems.map((item) => (
              <article key={item.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{item.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.status ? (
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                        status: {item.status}
                      </span>
                    ) : null}
                    {item.answerSource ? (
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                        source: {item.answerSource}
                      </span>
                    ) : null}
                    {item.retrievalMode ? (
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                        retrieval: {item.retrievalMode}
                      </span>
                    ) : null}
                    {typeof item.confidence === "number" ? (
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                        confidence: {item.confidence}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">질문</div>
                    <div className="rounded-xl bg-background px-4 py-3 text-sm text-foreground">{item.query}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">답변 요약</div>
                    <div className="rounded-xl bg-background px-4 py-3 text-sm leading-relaxed text-foreground">
                      {truncate(item.answerText, 220)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => onReplay(item.query)}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90"
                    type="button"
                  >
                    <RotateCcw className="h-4 w-4" />
                    다시 질문
                  </button>
                  {item.linkUrl ? (
                    <a
                      href={item.linkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                    >
                      {item.linkLabel ?? "유사 이력 바로가기"}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
