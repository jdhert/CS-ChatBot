"use client"

import Link from "next/link"
import { Bot, Download, Menu, Moon, ScrollText, Search, Sun } from "lucide-react"

interface ChatHeaderProps {
  isDarkMode: boolean
  onToggleDarkMode: () => void
  onExportChat?: () => void
  onOpenSidebar?: () => void
}

export function ChatHeader({ isDarkMode, onToggleDarkMode, onExportChat, onOpenSidebar }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-4 md:px-6">
      <div className="flex items-center gap-3">
        {/* 모바일 햄버거 버튼 */}
        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
            aria-label="대화 목록 열기"
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-400 text-white shadow-lg">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-foreground md:text-base">코비전 CS Bot</h1>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs text-muted-foreground">연결 중</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/search"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="이력 검색"
          title="SCC 이력 검색"
        >
          <Search className="h-5 w-5" />
        </Link>
        <Link
          href="/logs"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="쿼리 로그"
          title="쿼리 로그 대시보드"
        >
          <ScrollText className="h-5 w-5" />
        </Link>
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
