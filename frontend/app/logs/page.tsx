"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface LogRow {
  log_uuid: string
  query: string
  retrieval_scope: string | null
  confidence: number | null
  best_require_id: string | null
  best_scc_id: string | null
  chunk_type: string | null
  vector_used: boolean | null
  retrieval_mode: string | null
  answer_source: string | null
  llm_used: boolean | null
  llm_skipped: boolean | null
  llm_skip_reason: string | null
  is_no_match: boolean | null
  is_failure: boolean | null
  failure_reason: string | null
  rule_ms: number | null
  embedding_ms: number | null
  vector_ms: number | null
  rerank_ms: number | null
  retrieval_ms: number | null
  llm_ms: number | null
  total_ms: number | null
  user_feedback: string | null
  created_at: string
}

interface LogsResponse {
  total: number
  limit: number
  offset: number
  filter: string
  rows: LogRow[]
}

const SCC_VIEW_URL =
  "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx"

const FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "failure", label: "실패" },
  { value: "no_match", label: "결과 없음" },
  { value: "low_confidence", label: "낮은 정확도" },
] as const

const ANSWER_SOURCE_LABEL: Record<string, string> = {
  llm: "LLM",
  deterministic_fallback: "결정형 안내",
  rule_only: "룰 기반",
  llm_stream: "스트리밍 LLM",
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function confidenceColor(v: number | null) {
  if (v === null) return "text-muted-foreground"
  if (v >= 0.7) return "text-emerald-600 dark:text-emerald-400"
  if (v >= 0.45) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">-</span>
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-400" : "bg-red-500"
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-xs tabular-nums", confidenceColor(value))}>{pct}%</span>
    </div>
  )
}

function StatusBadge({ row }: { row: LogRow }) {
  if (row.is_failure) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <XCircle className="h-3 w-3" />
        {row.failure_reason === "NO_MATCH"
          ? "결과 없음"
          : row.failure_reason === "LOW_CONFIDENCE"
            ? "낮은 정확도"
            : "실패"}
      </span>
    )
  }

  if (row.is_no_match) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        결과 없음
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" />
      성공
    </span>
  )
}

function TimingChip({ label, ms }: { label: string; ms: number | null }) {
  if (!ms) return null
  return (
    <span className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <Clock className="h-2.5 w-2.5" />
      {label} {ms}ms
    </span>
  )
}

function LogRowCard({ row }: { row: LogRow }) {
  const [expanded, setExpanded] = useState(false)
  const sccUrl = row.best_require_id
    ? `${SCC_VIEW_URL}?req_id=${row.best_require_id}&system=Menu01&alias=Menu01.Service.List&mnid=705`
    : null

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-shadow",
        row.is_failure ? "border-red-200 dark:border-red-800/60" : "border-border",
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left"
        type="button"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge row={row} />
            <span className="line-clamp-1 text-sm font-medium text-foreground">{row.query}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ConfidenceBar value={row.confidence} />
            {row.retrieval_mode && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  row.retrieval_mode === "hybrid"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {row.retrieval_mode === "hybrid" ? "하이브리드" : "룰 전용"}
              </span>
            )}
            {row.vector_used && (
              <span className="flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                <Zap className="h-2.5 w-2.5" />
                벡터 사용
              </span>
            )}
            {row.answer_source && (
              <span className="text-[10px] text-muted-foreground">
                {ANSWER_SOURCE_LABEL[row.answer_source] ?? row.answer_source}
              </span>
            )}
            {row.user_feedback && (
              <span className="text-[10px] text-muted-foreground">
                {row.user_feedback === "up" ? "좋아요" : "싫어요"}
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">{formatDate(row.created_at)}</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
          <div className="flex flex-wrap gap-1.5">
            <TimingChip label="룰" ms={row.rule_ms} />
            <TimingChip label="임베딩" ms={row.embedding_ms} />
            <TimingChip label="벡터" ms={row.vector_ms} />
            <TimingChip label="LLM" ms={row.llm_ms} />
            <TimingChip label="전체" ms={row.total_ms} />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            {row.chunk_type && (
              <>
                <dt className="text-muted-foreground">청크 타입</dt>
                <dd className="font-medium text-foreground">{row.chunk_type}</dd>
              </>
            )}
            {row.best_scc_id && (
              <>
                <dt className="text-muted-foreground">SCC ID</dt>
                <dd className="font-medium text-foreground">{row.best_scc_id}</dd>
              </>
            )}
            {row.llm_skip_reason && (
              <>
                <dt className="text-muted-foreground">LLM 스킵 사유</dt>
                <dd className="font-medium text-foreground">{row.llm_skip_reason}</dd>
              </>
            )}
            {row.failure_reason && (
              <>
                <dt className="text-muted-foreground">실패 사유</dt>
                <dd className="font-medium text-red-600 dark:text-red-400">{row.failure_reason}</dd>
              </>
            )}
          </dl>

          {sccUrl && (
            <a
              href={sccUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              SCC 이력 보기
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export default function LogsPage() {
  useEffect(() => {
    const apply = (dark: boolean) => {
      document.documentElement.classList.toggle("dark", dark)
    }
    apply(localStorage.getItem("darkMode") === "true")
    const handler = (e: StorageEvent) => {
      if (e.key === "darkMode") apply(e.newValue === "true")
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [])

  const [filter, setFilter] = useState<string>("all")
  const [data, setData] = useState<LogsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const limit = 50
  const abortRef = useRef<AbortController | null>(null)

  const fetchLogs = useCallback(
    async (f: string, o: number) => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/logs?filter=${f}&limit=${limit}&offset=${o}`, {
          signal: abortRef.current.signal,
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "로그를 불러오지 못했습니다")
        setData(json)
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return
        setError(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다")
      } finally {
        setLoading(false)
      }
    },
    [limit],
  )

  useEffect(() => {
    setOffset(0)
    fetchLogs(filter, 0)
  }, [filter, fetchLogs])

  const totalPages = data ? Math.ceil(data.total / limit) : 0
  const currentPage = Math.floor(offset / limit)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link
            href="/"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="채팅으로 돌아가기"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-sm font-semibold text-foreground">쿼리 로그</h1>
          <div className="ml-auto flex items-center gap-2">
            {data && <span className="text-xs text-muted-foreground">총 {data.total.toLocaleString()}건</span>}
            <button
              onClick={() => fetchLogs(filter, offset)}
              disabled={loading}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="새로고침"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-6">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                filter === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}

        {!loading && data && data.rows.length === 0 && (
          <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
            해당 조건의 로그가 없습니다.
          </div>
        )}

        {data && data.rows.length > 0 && (
          <div className="space-y-2">
            {data.rows.map((row) => (
              <LogRowCard key={row.log_uuid} row={row} />
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => {
                const o = Math.max(0, offset - limit)
                setOffset(o)
                fetchLogs(filter, o)
              }}
              disabled={offset === 0}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-xs text-muted-foreground">
              {currentPage + 1} / {totalPages}
            </span>
            <button
              onClick={() => {
                const o = offset + limit
                setOffset(o)
                fetchLogs(filter, o)
              }}
              disabled={offset + limit >= (data?.total ?? 0)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
