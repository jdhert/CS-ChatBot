"use client"

import { useEffect, useState, type KeyboardEvent } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ExternalLink,
  Search,
  X,
  Zap,
  Clock,
  LayoutList,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface SearchCandidate {
  requireId: string
  sccId: string
  score: number
  ruleScore: number
  vectorScore: number
  blendedScore: number
  chunkType: string
  previewText: string
  issuePreview: string | null
  actionPreview: string | null
  resolutionPreview: string | null
  qaPairPreview: string | null
  hasResolution: boolean
  hasQaPair: boolean
  hasVectorSignal: boolean
  relevancePassed: boolean
  relevanceReason: string | null
}

interface SearchResult {
  query: string
  candidates: SearchCandidate[]
  bestRequireId: string | null
  bestSccId: string | null
  bestChunkType: string | null
  confidence: number
  vectorUsed: boolean
  retrievalMode: string
  vectorError: string | null
  timings: {
    ruleMs: number
    embeddingMs: number
    vectorMs: number
    rerankMs: number
    retrievalMs: number
    cacheHit: boolean
  }
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const SCC_VIEW_URL = "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx"

const CHUNK_TYPE_LABEL: Record<string, string> = {
  issue: "증상",
  action: "조치",
  resolution: "처리",
  qa_pair: "Q&A",
}

const CHUNK_TYPE_COLORS: Record<string, string> = {
  issue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  action: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  resolution: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  qa_pair: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
}

const CHUNK_TYPE_FILTERS = ["전체", "issue", "action", "resolution", "qa_pair"] as const

function buildSccUrl(requireId: string) {
  return `${SCC_VIEW_URL}?req_id=${requireId}&system=Menu01&alias=Menu01.Service.List&mnid=705`
}

// ─── 서브 컴포넌트 ─────────────────────────────────────────────────────────

function ScoreBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100)
  const color =
    pct >= 60 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-muted-foreground/40"
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  )
}

function CandidateCard({ candidate, rank }: { candidate: SearchCandidate; rank: number }) {
  const [expanded, setExpanded] = useState(false)
  const chunkLabel = CHUNK_TYPE_LABEL[candidate.chunkType] ?? candidate.chunkType
  const chunkColor = CHUNK_TYPE_COLORS[candidate.chunkType] ?? "bg-muted text-muted-foreground"
  const sccUrl = buildSccUrl(candidate.requireId)
  const preview = candidate.previewText ?? ""
  const truncated = preview.length > 120 ? preview.slice(0, 120) + "…" : preview

  const detailPreviews = [
    candidate.issuePreview && { label: "증상", text: candidate.issuePreview },
    candidate.actionPreview && { label: "조치", text: candidate.actionPreview },
    candidate.resolutionPreview && { label: "처리", text: candidate.resolutionPreview },
    candidate.qaPairPreview && { label: "Q&A", text: candidate.qaPairPreview },
  ].filter(Boolean) as { label: string; text: string }[]

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* 카드 헤더 */}
      <div className="flex items-start gap-3 p-4">
        {/* 순위 */}
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {rank}
        </span>

        <div className="min-w-0 flex-1">
          {/* 메타 행 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">SCC {candidate.sccId}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", chunkColor)}>
              {chunkLabel}
            </span>
            {candidate.hasResolution && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                처리완료
              </span>
            )}
            {candidate.hasQaPair && (
              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                Q&A
              </span>
            )}
            {candidate.hasVectorSignal && (
              <span className="flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                <Zap className="h-2.5 w-2.5" />
                벡터
              </span>
            )}
          </div>

          {/* 점수 행 */}
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">종합</span>
              <ScoreBar value={candidate.blendedScore} />
            </div>
            {candidate.ruleScore > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">룰</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(candidate.ruleScore * 100)}%
                </span>
              </div>
            )}
            {candidate.vectorScore > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">벡터</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {Math.round(candidate.vectorScore * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* 미리보기 */}
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {expanded ? preview : truncated}
          </p>

          {/* 펼치기 / 청크 상세 */}
          {(preview.length > 120 || detailPreviews.length > 0) && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 text-[10px] text-primary hover:underline"
            >
              {expanded ? "접기" : "더 보기"}
            </button>
          )}

          {expanded && detailPreviews.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              {detailPreviews.map(({ label, text }) => (
                <div key={label}>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </span>
                  <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 링크 버튼 */}
        <a
          href={sccUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          title="SCC 이력 보기"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">이력 보기</span>
        </a>
      </div>
    </div>
  )
}

function TimingBadge({ label, ms }: { label: string; ms: number }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
      <Clock className="h-2.5 w-2.5" />
      {label} {ms}ms
    </span>
  )
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function SearchPage() {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chunkFilter, setChunkFilter] = useState<string>("전체")

  // 챗봇 페이지와 다크모드 상태 공유 (localStorage)
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

  async function handleSearch() {
    const q = query.trim()
    if (!q || loading) return

    setLoading(true)
    setError(null)
    setResult(null)
    setChunkFilter("전체")

    try {
      const res = await fetch("/api/retrieval/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, retrievalScope: "scc" }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? "검색 실패")
      } else {
        setResult(data)
      }
    } catch {
      setError("서버에 연결할 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSearch()
  }

  const filtered =
    result?.candidates.filter(
      (c) => chunkFilter === "전체" || c.chunkType === chunkFilter,
    ) ?? []

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Link
            href="/"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="챗봇으로 돌아가기"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="SCC 이력 검색 (예: 휴가신청서 상신 불가)"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="입력 지우기"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={handleSearch}
            disabled={!query.trim() || loading}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-all",
              query.trim() && !loading
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                검색 중
              </>
            ) : (
              "검색"
            )}
          </button>
        </div>
      </header>

      {/* 본문 */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-6">

        {/* 초기 안내 */}
        {!result && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-blue-400 text-white shadow-lg">
              <LayoutList className="h-7 w-7" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-foreground">SCC 이력 검색</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              LLM 없이 유사 이력 후보를 빠르게 조회합니다.
              <br />
              점수·청크 타입·벡터 신호를 함께 확인할 수 있습니다.
            </p>
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* 결과 */}
        {result && (
          <div className="space-y-4">
            {/* 결과 요약 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {filtered.length}건
                  {chunkFilter !== "전체" && (
                    <span className="ml-1 text-muted-foreground">({result.candidates.length}건 중)</span>
                  )}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    result.retrievalMode === "hybrid"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                  )}
                >
                  {result.retrievalMode === "hybrid" ? "하이브리드" : "룰 전용"}
                </span>
                {result.vectorUsed && (
                  <span className="flex items-center gap-0.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                    <Zap className="h-2.5 w-2.5" />
                    벡터 검색 사용
                  </span>
                )}
              </div>
              {/* 타이밍 */}
              <div className="flex flex-wrap gap-1">
                {result.timings.cacheHit ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    캐시 히트
                  </span>
                ) : (
                  <>
                    <TimingBadge label="룰" ms={result.timings.ruleMs} />
                    {result.timings.embeddingMs > 0 && (
                      <TimingBadge label="임베딩" ms={result.timings.embeddingMs} />
                    )}
                    {result.timings.vectorMs > 0 && (
                      <TimingBadge label="벡터" ms={result.timings.vectorMs} />
                    )}
                    <TimingBadge label="전체" ms={result.timings.retrievalMs} />
                  </>
                )}
              </div>
            </div>

            {/* 청크 타입 필터 */}
            <div className="flex flex-wrap gap-1.5">
              {CHUNK_TYPE_FILTERS.map((f) => {
                const count =
                  f === "전체"
                    ? result.candidates.length
                    : result.candidates.filter((c) => c.chunkType === f).length
                if (count === 0 && f !== "전체") return null
                return (
                  <button
                    key={f}
                    onClick={() => setChunkFilter(f)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      chunkFilter === f
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                    )}
                  >
                    {f === "전체" ? "전체" : CHUNK_TYPE_LABEL[f]}
                    <span className="ml-1 opacity-60">{count}</span>
                  </button>
                )
              })}
            </div>

            {/* 결과 없음 */}
            {filtered.length === 0 && (
              <div className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
                해당 조건의 결과가 없습니다.
              </div>
            )}

            {/* 카드 목록 */}
            <div className="space-y-3">
              {filtered.map((c, i) => (
                <CandidateCard key={c.requireId} candidate={c} rank={i + 1} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
