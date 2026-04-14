"use client"

import Link from "next/link"
import { Bot, Download, Menu, Moon, MoreHorizontal, ScrollText, Search, Sun } from "lucide-react"
import { getChatExportFormatLabel, type ChatExportFormat } from "@/lib/chat-export"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ChatHeaderProps {
  isDarkMode: boolean
  onToggleDarkMode: () => void
  onExportChat?: (format: ChatExportFormat) => void
  onOpenSidebar?: () => void
}

const exportFormats: ChatExportFormat[] = ["txt", "md", "pdf"]

export function ChatHeader({ isDarkMode, onToggleDarkMode, onExportChat, onOpenSidebar }: ChatHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-3 py-3 md:px-6 md:py-4">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        {onOpenSidebar ? (
          <button
            onClick={onOpenSidebar}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
            aria-label="대화 목록 열기"
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : null}

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

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/logs"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="로그 대시보드"
            title="로그 대시보드"
          >
            <ScrollText className="h-5 w-5" />
          </Link>

          {onExportChat ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label="대화 내보내기"
                  title="대화 내보내기"
                  type="button"
                >
                  <Download className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>대화 내보내기</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {exportFormats.map((format) => (
                  <DropdownMenuItem key={format} onClick={() => onExportChat(format)}>
                    <span>{getChatExportFormatLabel(format)}</span>
                    <span className="ml-auto text-[10px] uppercase text-muted-foreground">
                      {format === "pdf" ? "print" : format}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <button
            onClick={onToggleDarkMode}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="다크 모드 전환"
            title={isDarkMode ? "라이트 모드로 전환" : "다크 모드로 전환"}
            type="button"
          >
            {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
              aria-label="더보기 메뉴"
              title="더보기 메뉴"
              type="button"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>빠른 메뉴</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/logs" className="flex w-full items-center gap-2">
                <ScrollText className="h-4 w-4" />
                <span>로그 대시보드</span>
              </Link>
            </DropdownMenuItem>
            {onExportChat ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>대화 내보내기</DropdownMenuLabel>
                {exportFormats.map((format) => (
                  <DropdownMenuItem key={format} onClick={() => onExportChat(format)}>
                    <Download className="h-4 w-4" />
                    <span>{getChatExportFormatLabel(format)}</span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleDarkMode}>
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{isDarkMode ? "라이트 모드" : "다크 모드"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
