"use client"

import { AlertCircle, Globe2, Sparkles, Zap } from "lucide-react"

interface QuickActionsProps {
  onSelect: (question: string) => void
}

const quickActions = [
  {
    label: "휴가신청 상신 불가",
    description: "상신 오류 원인과 조치 방법 안내",
    icon: AlertCircle,
    question: "휴가신청 상신이 불가능해",
    color: "from-rose-500 to-orange-400",
    bg: "bg-rose-50 dark:bg-rose-500/10",
    border: "border-rose-200/80 dark:border-rose-500/20",
    iconColor: "text-rose-500",
  },
  {
    label: "다국어 코드 추가",
    description: "코드 등록 절차와 설정 방법 안내",
    icon: Globe2,
    question: "다국어 코드를 추가하는 방법이 궁금해",
    color: "from-blue-500 to-cyan-400",
    bg: "bg-blue-50 dark:bg-blue-500/10",
    border: "border-blue-200/80 dark:border-blue-500/20",
    iconColor: "text-blue-500",
  },
  {
    label: "브라우저 캐시 문제",
    description: "캐시 저장·초기화 방법 안내",
    icon: Zap,
    question: "브라우저 캐시 저장이 되지 않아",
    color: "from-violet-500 to-purple-400",
    bg: "bg-violet-50 dark:bg-violet-500/10",
    border: "border-violet-200/80 dark:border-violet-500/20",
    iconColor: "text-violet-500",
  },
] as const

const suggestedQuestions = [
  "야간근무 일정을 어떻게 생성해?",
  "리스트 날짜 표시를 년월일만 나오게 바꾸는 방법이 있어?",
  "휴가신청 상신이 안 되는 이유가 있을까?",
  "결재함이 보이지 않아",
] as const

export function QuickActions({ onSelect }: QuickActionsProps) {
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
          <Zap className="h-3 w-3" />
          자주 찾는 질문
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.label}
                onClick={() => onSelect(action.question)}
                className={`group flex items-start gap-3 rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${action.bg} ${action.border}`}
                type="button"
              >
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${action.color} text-white shadow-sm`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{action.label}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{action.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
          <Sparkles className="h-3 w-3" />
          추천 질문
        </div>
        <div className="flex flex-wrap gap-2">
          {suggestedQuestions.map((question) => (
            <button
              key={question}
              onClick={() => onSelect(question)}
              className="rounded-full border border-border/80 bg-card px-3.5 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/50 hover:bg-accent hover:text-foreground hover:shadow-sm"
              type="button"
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
