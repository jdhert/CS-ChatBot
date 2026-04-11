"use client"

import type { ReactNode } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock,
  MessageCircleWarning,
  RefreshCw,
  Search,
  ThumbsDown,
  ThumbsUp,
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
  q: string
  days: number
  summary: LogSummary | null
  feedbackBreakdown: FeedbackBreakdownRow[]
  feedbackTopQueries: FeedbackTopQuery[]
  rateLimit: RateLimitSnapshot | null
  queryEmbedding: QueryEmbeddingSnapshot | null
  rows: LogRow[]
}

interface LogSummary {
  total: number
  failure_count: number
  no_match_count: number
  low_confidence_count: number
  feedback_up_count: number
  feedback_down_count: number
  feedback_total_count: number
  feedback_positive_rate_pct: number | null
  feedback_negative_rate_pct: number | null
  hybrid_count: number
  rule_only_count: number
  slow_count: number
  avg_confidence: number | null
  avg_total_ms: number | null
  avg_retrieval_ms: number | null
  latest_at: string | null
}

interface FeedbackBreakdownRow {
  answer_source: string
  retrieval_mode: string
  feedback_count: number
  up_count: number
  down_count: number
  down_rate_pct: number | null
  avg_confidence: number | null
  avg_total_ms: number | null
}

interface FeedbackTopQuery {
  query: string
  down_count: number
  latest_at: string
  sample_log_uuid: string | null
  sample_require_id: string | null
  sample_scc_id: string | null
  avg_confidence: number | null
  avg_total_ms: number | null
}

interface RateLimitSnapshot {
  enabled: boolean
  windowMs: number
  bucketCount: number
  eventBufferSize: number
  blockedCount: number
  latestBlockedAt: string | null
  byGroup: RateLimitGroupRow[]
  recent: RateLimitEventRow[]
}

interface RateLimitGroupRow {
  group: string
  blocked_count: number
  latest_at: string
}

interface RateLimitEventRow {
  blockedAt: string
  group: string
  path: string
  method: string
  ip: string
  max: number
  resetInSeconds: number
}

interface QueryEmbeddingSnapshot {
  attempts: number
  cacheHits: number
  successes: number
  failures: number
  cooldownHits: number
  cooldownActivations: number
  lastModelTag: string | null
  lastError: string | null
  lastFailureAt: string | null
  lastSuccessAt: string | null
  lastCooldownActivatedAt: string | null
  cacheSize: number
  retrievalCacheSize: number
  modelCacheSize: number
  activeCooldownCount: number
  activeCooldowns: QueryEmbeddingCooldown[]
}

interface QueryEmbeddingCooldown {
  modelTag: string
  cooldownUntil: string
  remainingMs: number
}

const SCC_VIEW_URL =
  "https://cs.covision.co.kr/WebSite/Basic/ServiceManagement/Service_View.aspx"

const FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "failure", label: "실패" },
  { value: "no_match", label: "결과 없음" },
  { value: "low_confidence", label: "낮은 정확도" },
  { value: "feedback_down", label: "싫어요" },
  { value: "feedback_up", label: "좋아요" },
  { value: "slow", label: "느린 쿼리" },
  { value: "hybrid", label: "하이브리드" },
  { value: "rule_only", label: "룰 전용" },
] as const

const DAY_OPTIONS = [
  { value: 1, label: "1일" },
  { value: 7, label: "7일" },
  { value: 30, label: "30일" },
  { value: 90, label: "90일" },
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

function formatPct(value: number | null) {
  return value === null ? "-" : `${value}%`
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

function SummaryCard({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
}: {
  label: string
  value: string
  sub?: string
  tone?: "neutral" | "success" | "warning" | "danger" | "info"
  icon: ReactNode
}) {
  const toneClass = {
    neutral: "border-border bg-card text-muted-foreground",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
    danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
    info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300",
  }[tone]

  return (
    <div className={cn("rounded-2xl border p-3 shadow-sm", toneClass)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">{label}</span>
        <span className="opacity-80">{icon}</span>
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-1 text-[11px] opacity-80">{sub}</div>}
    </div>
  )
}

function FeedbackAnalysis({
  breakdown,
  topQueries,
}: {
  breakdown: FeedbackBreakdownRow[]
  topQueries: FeedbackTopQuery[]
}) {
  if (breakdown.length === 0 && topQueries.length === 0) {
    return (
      <section className="mb-5 rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
        선택한 기간에 수집된 사용자 피드백이 아직 없습니다.
      </section>
    )
  }

  return (
    <section className="mb-5 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">답변 경로별 피드백</h2>
            <p className="text-xs text-muted-foreground">싫어요 비율이 높은 경로부터 점검합니다.</p>
          </div>
          <ThumbsDown className="h-4 w-4 text-muted-foreground" />
        </div>

        {breakdown.length === 0 ? (
          <div className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">피드백 데이터가 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {breakdown.map((row) => {
              const source = ANSWER_SOURCE_LABEL[row.answer_source] ?? row.answer_source
              const mode = row.retrieval_mode === "hybrid" ? "하이브리드" : row.retrieval_mode === "rule_only" ? "룰 전용" : row.retrieval_mode
              const downRate = row.down_rate_pct ?? 0
              return (
                <div key={`${row.answer_source}:${row.retrieval_mode}`} className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{source}</div>
                      <div className="text-xs text-muted-foreground">{mode}</div>
                    </div>
                    <div className={cn("text-right text-sm font-semibold", downRate >= 50 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                      {formatPct(row.down_rate_pct)}
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.min(downRate, 100)}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span>피드백 {row.feedback_count.toLocaleString()}건</span>
                    <span>좋아요 {row.up_count.toLocaleString()}</span>
                    <span>싫어요 {row.down_count.toLocaleString()}</span>
                    {row.avg_total_ms !== null && <span>평균 {row.avg_total_ms.toLocaleString()}ms</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">싫어요 Top 질의</h2>
            <p className="text-xs text-muted-foreground">평가셋 편입이나 검색 튜닝 후보로 봅니다.</p>
          </div>
          <MessageCircleWarning className="h-4 w-4 text-muted-foreground" />
        </div>

        {topQueries.length === 0 ? (
          <div className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">싫어요 피드백 질의가 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {topQueries.map((row) => (
              <button
                key={`${row.query}:${row.sample_log_uuid ?? row.latest_at}`}
                type="button"
                onClick={() => void navigator.clipboard?.writeText(row.query)}
                className="w-full rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                title="질문 복사"
              >
                <div className="line-clamp-2 text-sm font-medium text-foreground">{row.query}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span>싫어요 {row.down_count.toLocaleString()}건</span>
                  {row.avg_confidence !== null && <span>평균 신뢰도 {Math.round(row.avg_confidence * 100)}%</span>}
                  {row.avg_total_ms !== null && <span>평균 {row.avg_total_ms.toLocaleString()}ms</span>}
                  {row.sample_scc_id && <span>SCC {row.sample_scc_id}</span>}
                  <span>최근 {formatDate(row.latest_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function RateLimitMonitoring({ snapshot }: { snapshot: RateLimitSnapshot | null }) {
  if (!snapshot) return null

  const windowSeconds = Math.round(snapshot.windowMs / 1000)

  return (
    <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Rate Limit 차단 현황</h2>
          <p className="text-xs text-muted-foreground">
            현재 프로세스 메모리 기준 최근 차단 이벤트입니다. 재배포/재기동 시 초기화됩니다.
          </p>
        </div>
        <AlertTriangle className={cn("h-4 w-4", snapshot.blockedCount > 0 ? "text-amber-500" : "text-muted-foreground")} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] text-muted-foreground">상태</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{snapshot.enabled ? "활성" : "비활성"}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">윈도우 {windowSeconds}초</div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] text-muted-foreground">선택 기간 차단</div>
          <div className={cn("mt-1 text-sm font-semibold", snapshot.blockedCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
            {snapshot.blockedCount.toLocaleString()}건
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            최근 {snapshot.latestBlockedAt ? formatDate(snapshot.latestBlockedAt) : "없음"}
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] text-muted-foreground">활성 버킷</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{snapshot.bucketCount.toLocaleString()}개</div>
          <div className="mt-1 text-[11px] text-muted-foreground">IP/경로 그룹 기준</div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] text-muted-foreground">이벤트 버퍼</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{snapshot.eventBufferSize.toLocaleString()}건</div>
          <div className="mt-1 text-[11px] text-muted-foreground">기본 최대 500건</div>
        </div>
      </div>

      {snapshot.byGroup.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 text-xs font-semibold text-foreground">경로 그룹별 차단</div>
            <div className="space-y-2">
              {snapshot.byGroup.map((row) => (
                <div key={row.group} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">{row.group}</span>
                  <span className="text-muted-foreground">
                    {row.blocked_count.toLocaleString()}건 · {formatDate(row.latest_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border p-3">
            <div className="mb-2 text-xs font-semibold text-foreground">최근 차단 요청</div>
            <div className="space-y-2">
              {snapshot.recent.slice(0, 8).map((row) => (
                <div key={`${row.blockedAt}:${row.group}:${row.ip}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{row.group}</span>
                  <span>{row.method} {row.path}</span>
                  <span>IP {row.ip}</span>
                  <span>limit {row.max}</span>
                  <span>{formatDate(row.blockedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function QueryEmbeddingMonitoring({ snapshot }: { snapshot: QueryEmbeddingSnapshot | null }) {
  if (!snapshot) return null

  const activeCooldown = snapshot.activeCooldowns[0]
  const cooldownMinutes = activeCooldown ? Math.ceil(activeCooldown.remainingMs / 60_000) : 0

  return (
    <section className="mb-5 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Query Embedding 상태</h2>
          <p className="text-xs text-muted-foreground">
            Google/OpenAI 쿼리 임베딩 캐시와 429 cooldown 상태입니다. 프로세스 재기동 시 초기화됩니다.
          </p>
        </div>
        <Zap className={cn("h-4 w-4", snapshot.activeCooldownCount > 0 ? "text-amber-500" : "text-blue-500")} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] text-muted-foreground">현재 모델</div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">{snapshot.lastModelTag ?? "-"}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">model auto-align 반영</div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] text-muted-foreground">성공 / 실패</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {snapshot.successes.toLocaleString()} / {snapshot.failures.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">시도 {snapshot.attempts.toLocaleString()} · 캐시 {snapshot.cacheHits.toLocaleString()}</div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] text-muted-foreground">Cooldown</div>
          <div className={cn("mt-1 text-sm font-semibold", snapshot.activeCooldownCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
            {snapshot.activeCooldownCount > 0 ? `${cooldownMinutes}분 남음` : "없음"}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">활성 {snapshot.activeCooldownCount} · 발생 {snapshot.cooldownActivations}</div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] text-muted-foreground">캐시 크기</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{snapshot.cacheSize.toLocaleString()}개</div>
          <div className="mt-1 text-[11px] text-muted-foreground">retrieval {snapshot.retrievalCacheSize} · model {snapshot.modelCacheSize}</div>
        </div>
      </div>

      {(snapshot.lastError || activeCooldown) && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          {snapshot.lastError && <div>최근 오류: <span className="font-semibold">{snapshot.lastError}</span></div>}
          {snapshot.lastFailureAt && <div>최근 실패: {formatDate(snapshot.lastFailureAt)}</div>}
          {activeCooldown && (
            <div>
              cooldown 모델: {activeCooldown.modelTag} · 해제 예정 {formatDate(activeCooldown.cooldownUntil)}
            </div>
          )}
        </div>
      )}
    </section>
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
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("")
  const [days, setDays] = useState(7)
  const [data, setData] = useState<LogsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const limit = 50
  const abortRef = useRef<AbortController | null>(null)

  const fetchLogs = useCallback(
    async (f: string, o: number, q: string, d: number) => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          filter: f,
          limit: String(limit),
          offset: String(o),
          days: String(d),
        })
        if (q.trim()) params.set("q", q.trim())
        const res = await fetch(`/api/admin/logs?${params.toString()}`, {
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
    fetchLogs(filter, 0, appliedQuery, days)
  }, [filter, appliedQuery, days, fetchLogs])

  const totalPages = data ? Math.ceil(data.total / limit) : 0
  const currentPage = Math.floor(offset / limit)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
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
              onClick={() => fetchLogs(filter, offset, appliedQuery, days)}
              disabled={loading}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="새로고침"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
        {data?.summary && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label={`${data.days}일 내 로그`}
              value={data.summary.total.toLocaleString()}
              sub={data.summary.latest_at ? `최근 ${formatDate(data.summary.latest_at)}` : "최근 로그 없음"}
              icon={<BarChart3 className="h-4 w-4" />}
              tone="info"
            />
            <SummaryCard
              label="실패 / 결과 없음"
              value={`${data.summary.failure_count.toLocaleString()}건`}
              sub={`no-match ${data.summary.no_match_count.toLocaleString()} · 저신뢰 ${data.summary.low_confidence_count.toLocaleString()}`}
              icon={<MessageCircleWarning className="h-4 w-4" />}
              tone={data.summary.failure_count > 0 ? "danger" : "success"}
            />
            <SummaryCard
              label="사용자 피드백"
              value={`${data.summary.feedback_up_count.toLocaleString()} / ${data.summary.feedback_down_count.toLocaleString()}`}
              sub={`좋아요율 ${formatPct(data.summary.feedback_positive_rate_pct)} · 싫어요율 ${formatPct(data.summary.feedback_negative_rate_pct)}`}
              icon={
                <span className="flex items-center gap-1">
                  <ThumbsUp className="h-3.5 w-3.5" />
                  <ThumbsDown className="h-3.5 w-3.5" />
                </span>
              }
              tone={data.summary.feedback_down_count > 0 ? "warning" : "neutral"}
            />
            <SummaryCard
              label="평균 응답 시간"
              value={data.summary.avg_total_ms ? `${data.summary.avg_total_ms.toLocaleString()}ms` : "-"}
              sub={`느린 쿼리 ${data.summary.slow_count.toLocaleString()} · hybrid ${data.summary.hybrid_count.toLocaleString()}`}
              icon={<Clock className="h-4 w-4" />}
              tone={data.summary.slow_count > 0 ? "warning" : "neutral"}
            />
          </div>
        )}

        {data && (
          <RateLimitMonitoring snapshot={data.rateLimit ?? null} />
        )}

        {data && (
          <QueryEmbeddingMonitoring snapshot={data.queryEmbedding ?? null} />
        )}

        {data && (
          <FeedbackAnalysis
            breakdown={data.feedbackBreakdown ?? []}
            topQueries={data.feedbackTopQueries ?? []}
          />
        )}

        <form
          className="mb-4 grid gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm md:grid-cols-[1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            setOffset(0)
            setAppliedQuery(query)
          }}
        >
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="질문 키워드 검색"
              className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
            />
          </label>
          <select
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value))
              setOffset(0)
            }}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
            aria-label="조회 기간"
          >
            {DAY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                최근 {opt.label}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              검색
            </button>
            {(appliedQuery || query) && (
              <button
                type="button"
                onClick={() => {
                  setQuery("")
                  setAppliedQuery("")
                  setOffset(0)
                }}
                className="h-10 rounded-xl border border-border px-4 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                초기화
              </button>
            )}
          </div>
        </form>

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
                fetchLogs(filter, o, appliedQuery, days)
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
                fetchLogs(filter, o, appliedQuery, days)
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
