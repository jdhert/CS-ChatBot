"use client"

import Link from "next/link"
import { useState } from "react"
import { Bot, Download, Menu, Moon, ScrollText, Search, Sun } from "lucide-react"
import { getChatExportFormatLabel, type ChatExportFormat } from "@/lib/chat-export"

interface ChatHeaderProps {
  isDarkMode: boolean
  onToggleDarkMode: () => void
  onExportChat?: (format: ChatExportFormat) => void
  onOpenSidebar?: () => void
}

const exportFormats: ChatExportFormat[] = ["txt", "md", "pdf"]

export function ChatHeader({ isDarkMode, onToggleDarkMode, onExportChat, onOpenSidebar }: ChatHeaderProps) {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false)

  const handleExport = (format: ChatExportFormat) => {
    setIsExportMenuOpen(false)
    onExportChat?.(format)
  }

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-3 py-3 md:px-6 md:py-4">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
            aria-label="대화 목록 열기"
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-400 text-white shadow-lg">
          <Bot className="h-5 w-5" />
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground md:text-base">코비전 CS Bot</h1>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs text-muted-foreground">연결 중</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 md:gap-2">
        <Link
          href="/search"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:h-9 md:w-9 md:rounded-lg"
          aria-label="검색"
          title="검색"
        >
          <Search className="h-5 w-5" />
        </Link>

        <Link
          href="/logs"
          className="hidden h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground min-[421px]:flex md:h-9 md:w-9 md:rounded-lg"
          aria-label="로그 대시보드"
          title="로그 대시보드"
        >
          <ScrollText className="h-5 w-5" />
        </Link>

        {onExportChat && (
          <div className="relative hidden min-[421px]:block">
            <button
              onClick={() => setIsExportMenuOpen((open) => !open)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:h-9 md:w-9 md:rounded-lg"
              aria-label="대화 내보내기"
              aria-expanded={isExportMenuOpen}
              title="대화 내보내기"
              type="button"
            >
              <Download className="h-5 w-5" />
            </button>
            {isExportMenuOpen && (
              <div className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                {exportFormats.map((format) => (
                  <button
                    key={format}
                    onClick={() => handleExport(format)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                    type="button"
                  >
                    <span>{getChatExportFormatLabel(format)}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {format === "pdf" ? "print" : format}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={onToggleDarkMode}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:h-9 md:w-9 md:rounded-lg"
          aria-label="다크 모드 전환"
          title={isDarkMode ? "라이트 모드로 전환" : "다크 모드로 전환"}
          type="button"
        >
          {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
      </div>
    </header>
  )
}
