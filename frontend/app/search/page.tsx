"use client"

import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import Link from "next/link"
import { ArrowLeft, ExternalLink, Search, X } from "lucide-react"

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

const SCC_VIEW_URL = "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx"
const CHUNK_TYPE_FILTERS = ["전체", "issue", "action", "resolution", "qa_pair"] as const
const CHUNK_TYPE_LABEL: Record<string, string> = {
  issue: "증상",
  action: "조치",
  resolution: "처리",
  qa_pair: "Q&A",
}

function buildSccUrl(requireId: string) {
  return `${SCC_VIEW_URL}?req_id=${requireId}&system=Menu01&alias=Menu01.Service.List&mnid=705`
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

export default function SearchPage() {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chunkFilter, setChunkFilter] = useState<string>("전체")

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

  async function runSearch(rawQuery: string) {
    const q = rawQuery.trim()
    if (!q || loading) return

    setLoading(true)
    setError(null)
    setResult(null)
    setChunkFilter("전체")

    const params = new URLSearchParams(window.location.search)
    params.set("q", q)
    window.history.replaceState({}, "", `/search?${params.toString()}`)

    try {
      const res = await fetch("/api/retrieval/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, retrievalScope: "scc" }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.message ?? "검색에 실패했습니다.")
        return
      }

      setResult(data)
    } catch {
      setError("검색 서버에 연결하지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.trim() ?? ""
    if (!q) return
    setQuery((prev) => (prev === q ? prev : q))
    void runSearch(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSearch() {
    void runSearch(query)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSearch()
  }

  function handleClear() {
    setQuery("")
    setResult(null)
    setError(null)
    setChunkFilter("전체")
    window.history.replaceState({}, "", "/search")
  }

  const filteredCandidates = useMemo(() => {
    return result?.candidates.filter((candidate) => chunkFilter === "전체" || candidate.chunkType === chunkFilter) ?? []
  }, [result, chunkFilter])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 md:px-6">
          <Link
            href="/"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="채팅으로 돌아가기"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">검색 결과</p>
            <p className="text-xs text-muted-foreground">현재 질의를 URL에 반영하므로 새로고침과 공유가 가능합니다.</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-6">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="증상, 처리 방법, 오류 문구를 입력해 주세요"
                className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-11 text-sm outline-none transition focus:border-primary"
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                  aria-label="검색어 지우기"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "검색 중..." : "검색"}
            </button>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </section>
        )}

        {result && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">검색 요약</p>
                <h1 className="mt-1 text-lg font-semibold">{result.query}</h1>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2.5 py-1">신뢰도 {formatPercent(result.confidence)}</span>
                  <span className="rounded-full bg-muted px-2.5 py-1">모드 {result.retrievalMode}</span>
                  <span className="rounded-full bg-muted px-2.5 py-1">후보 {result.candidates.length}건</span>
                  <span className="rounded-full bg-muted px-2.5 py-1">검색 {result.timings.retrievalMs}ms</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {CHUNK_TYPE_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setChunkFilter(filter)}
                    className={`rounded-full px-3 py-1 text-xs transition ${chunkFilter === filter ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  >
                    {filter === "전체" ? filter : (CHUNK_TYPE_LABEL[filter] ?? filter)}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {result && (
          <section className="grid gap-3">
            {filteredCandidates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                현재 필터에 해당하는 후보가 없습니다.
              </div>
            ) : (
              filteredCandidates.map((candidate, index) => (
                <article key={`${candidate.requireId}-${candidate.chunkType}-${index}`} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">#{index + 1}</span>
                        <span>SCC {candidate.sccId}</span>
                        <span>{CHUNK_TYPE_LABEL[candidate.chunkType] ?? candidate.chunkType}</span>
                        <span>종합 {formatPercent(candidate.blendedScore)}</span>
                        {candidate.vectorScore > 0 && <span>벡터 {formatPercent(candidate.vectorScore)}</span>}
                        {candidate.ruleScore > 0 && <span>룰 {formatPercent(candidate.ruleScore)}</span>}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{candidate.previewText}</p>
                      {candidate.relevanceReason && (
                        <p className="mt-2 text-xs text-muted-foreground">관련성 메모: {candidate.relevanceReason}</p>
                      )}
                    </div>
                    <a
                      href={buildSccUrl(candidate.requireId)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
                    >
                      <span>이력 보기</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </article>
              ))
            )}
          </section>
        )}
      </main>
    </div>
  )
}
