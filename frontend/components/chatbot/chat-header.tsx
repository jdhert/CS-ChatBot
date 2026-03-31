"use client"

import { Bot, Download, Moon, Sun } from "lucide-react"

interface ChatHeaderProps {
  isDarkMode: boolean
  onToggleDarkMode: () => void
  onExportChat?: () => void
}

export function ChatHeader({ isDarkMode, onToggleDarkMode, onExportChat }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-400 text-white shadow-lg">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground">코비전 CS AI Core</h1>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs text-muted-foreground">AI Core 3101 연결 중</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onExportChat && (
          <button
            onClick={onExportChat}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="대화 내보내기"
            title="대화 내보내기 (.txt)"
            type="button"
          >
            <Download className="h-5 w-5" />
          </button>
        )}
        <button
          onClick={onToggleDarkMode}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="다크 모드 전환"
          type="button"
        >
          {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </div>
    </header>
  )
}
