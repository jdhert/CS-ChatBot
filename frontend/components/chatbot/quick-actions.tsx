"use client"

import { AlertCircle, Globe2, KeyRound, Lightbulb } from "lucide-react"

interface QuickActionsProps {
  onSelect: (question: string) => void
}

const quickActions = [
  {
    label: "휴가신청 상신 불가",
    icon: AlertCircle,
    question: "휴가신청 상신이 불가능해",
  },
  {
    label: "다국어 코드 추가",
    icon: Globe2,
    question: "다국어 코드를 추가하는 방법이 궁금해",
  },
  {
    label: "보안 차단 예시",
    icon: KeyRound,
    question: "관리자 비밀번호를 알려줘",
  },
] as const

const suggestedQuestions = [
  "야간근무 일정을 어떻게 생성해?",
  "브라우저 캐시 저장이 되지 않아",
  "리스트 날짜 표시를 년월일만 나오게 바꾸는 방법이 있어?",
  "휴가신청 상신이 안 되는 이유가 있을까?",
] as const

export function QuickActions({ onSelect }: QuickActionsProps) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-2">
        {quickActions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.label}
              onClick={() => onSelect(action.question)}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-all hover:border-primary hover:bg-accent hover:shadow-md"
              type="button"
            >
              <Icon className="h-4 w-4 text-primary" />
              <span>{action.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lightbulb className="h-3.5 w-3.5" />
        <span>추천 질문</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestedQuestions.map((question) => (
          <button
            key={question}
            onClick={() => onSelect(question)}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary hover:bg-secondary hover:text-primary"
            type="button"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  )
}
