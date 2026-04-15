"use client"

import Link from "next/link"
import { Bot, Download, Menu, Moon, MoreHorizontal, ScrollText, Search, Sun } from "lucide-react"
import {
  getChatExportFormatLabel,
  getChatExportScopeLabel,
  getChatExportTemplateDescription,
  getChatExportTemplateLabel,
  type ChatExportFormat,
  type ChatExportRequest,
  type ChatExportScope,
  type ChatExportTemplate,
} from "@/lib/chat-export"
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
  onExportChat?: (request: ChatExportRequest) => void
  onOpenSidebar?: () => void
}

const exportFormats: ChatExportFormat[] = ["txt", "md", "pdf"]
const exportTemplates: ChatExportTemplate[] = ["user", "operator", "report"]
const exportScopes: ChatExportScope[] = ["all", "latest_exchange", "latest_answer"]

const quickExportPresets: Array<{ label: string; description: string; request: ChatExportRequest }> = [
  {
    label: "최근 응답 PDF",
    description: "마지막 질의/응답만 PDF로 저장",
    request: { format: "pdf", template: "user", scope: "latest_exchange" },
  },
  {
    label: "운영 진단 PDF",
    description: "전체 대화 + 진단 정보 포함",
    request: { format: "pdf", template: "operator", scope: "all", includeDiagnostics: true },
  },
  {
    label: "공유용 보고 PDF",
    description: "최근 응답만 브리핑 문서로 저장",
    request: { format: "pdf", template: "report", scope: "latest_exchange" },
  },
]

function ExportMenuItems({ onExportChat }: { onExportChat: (request: ChatExportRequest) => void }) {
  return (
    <>
      <DropdownMenuLabel>빠른 내보내기</DropdownMenuLabel>
      {quickExportPresets.map((preset) => (
        <DropdownMenuItem key={preset.label} onClick={() => onExportChat(preset.request)}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span>{preset.label}</span>
            <span className="text-[10px] text-muted-foreground">{preset.description}</span>
          </div>
        </DropdownMenuItem>
      ))}
      {exportTemplates.map((template, templateIndex) => (
        <div key={template}>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{getChatExportTemplateLabel(template)}</DropdownMenuLabel>
          <div className="px-2 pb-1 text-[11px] text-muted-foreground">
            {getChatExportTemplateDescription(template)}
          </div>
          {exportScopes.map((scope) => (
            <div key={`${template}-${scope}`} className="pb-1">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {getChatExportScopeLabel(scope)}
              </div>
              {exportFormats.map((format) => (
                <DropdownMenuItem
                  key={`${template}-${scope}-${format}`}
                  onClick={() => onExportChat({ format, template, scope })}
                >
                  <div className="flex w-full items-center gap-3">
                    <span>{getChatExportFormatLabel(format)}</span>
                    <span className="ml-auto text-[10px] uppercase text-muted-foreground">
                      {format === "pdf" ? "print" : format}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

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
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>대화 내보내기</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ExportMenuItems onExportChat={onExportChat} />
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
          <DropdownMenuContent align="end" className="w-64">
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
                <ExportMenuItems onExportChat={onExportChat} />
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
