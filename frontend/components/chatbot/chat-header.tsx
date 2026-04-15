"use client"

import Link from "next/link"
import {
  Bot,
  Download,
  FileText,
  type LucideIcon,
  Menu,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Presentation,
  ScrollText,
  Search,
  ShieldCheck,
  Sun,
} from "lucide-react"
import { getChatExportFormatLabel, type ChatExportRequest } from "@/lib/chat-export"
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

type ExportMenuItem = {
  label: string
  description: string
  request: ChatExportRequest
  badge?: string
  tone?: "blue" | "violet" | "amber" | "slate"
  icon?: LucideIcon
  tagline?: string
}

const pdfExportItems: ExportMenuItem[] = [
  {
    label: "\uC751\uB2F5 PDF",
    description: "\uB9C8\uC9C0\uB9C9 \uC751\uB2F5 \uC800\uC7A5",
    request: { format: "pdf", template: "user", scope: "latest_exchange" },
    badge: "\uCD94\uCC9C",
    tone: "blue",
    icon: MessageSquareText,
    tagline: "\uAC1C\uC778\uC6A9",
  },
  {
    label: "\uC6B4\uC601 PDF",
    description: "\uC9C4\uB2E8 \uC815\uBCF4 \uD3EC\uD568",
    request: { format: "pdf", template: "operator", scope: "all", includeDiagnostics: true },
    tone: "violet",
    icon: ShieldCheck,
    tagline: "\uC6B4\uC601\uC6A9",
  },
  {
    label: "\uBCF4\uACE0 PDF",
    description: "\uACF5\uC720\uC6A9 \uBE0C\uB9AC\uD551",
    request: { format: "pdf", template: "report", scope: "latest_exchange" },
    tone: "amber",
    icon: Presentation,
    tagline: "\uACF5\uC720\uC6A9",
  },
]

const otherExportItems: ExportMenuItem[] = [
  {
    label: "TXT",
    description: "\uC804\uCCB4 \uB300\uD654",
    request: { format: "txt", template: "user", scope: "all" },
    badge: getChatExportFormatLabel("txt"),
    tone: "slate",
    icon: FileText,
  },
  {
    label: "MD",
    description: "\uBB38\uC11C \uACF5\uC720\uC6A9",
    request: { format: "md", template: "user", scope: "all" },
    badge: getChatExportFormatLabel("md"),
    tone: "slate",
    icon: ScrollText,
  },
]

function ExportSection({
  title,
  helper,
  items,
  onExportChat,
  variant = "other",
}: {
  title: string
  helper: string
  items: ExportMenuItem[]
  onExportChat: (request: ChatExportRequest) => void
  variant?: "pdf" | "other"
}) {
  const toneClass = (tone?: ExportMenuItem["tone"]) => {
    if (tone === "blue") return "border-blue-200/80 bg-gradient-to-br from-blue-50 via-white to-blue-100/70 shadow-[0_8px_24px_rgba(59,130,246,0.10)] dark:border-blue-500/30 dark:bg-blue-500/10"
    if (tone === "violet") return "border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-fuchsia-100/70 shadow-[0_8px_24px_rgba(139,92,246,0.10)] dark:border-violet-500/30 dark:bg-violet-500/10"
    if (tone === "amber") return "border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-100/70 shadow-[0_8px_24px_rgba(245,158,11,0.10)] dark:border-amber-500/30 dark:bg-amber-500/10"
    return "border-border bg-muted/40"
  }

  const iconToneClass = (tone?: ExportMenuItem["tone"]) => {
    if (tone === "blue") return "bg-blue-600 text-white shadow-sm"
    if (tone === "violet") return "bg-violet-600 text-white shadow-sm"
    if (tone === "amber") return "bg-amber-500 text-white shadow-sm"
    return "bg-muted text-muted-foreground"
  }

  return (
    <div className="space-y-1">
      <DropdownMenuLabel className="px-3 pt-1">{title}</DropdownMenuLabel>
      <div className="px-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">{helper}</div>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.label}
          onClick={() => onExportChat(item.request)}
          className="min-h-0 cursor-pointer rounded-2xl px-1.5 py-1.5 focus:bg-transparent data-[highlighted]:bg-transparent"
        >
          {(() => {
            const Icon = item.icon ?? FileText
            return (
              <div
                className={`flex w-full min-w-0 items-start gap-3 rounded-2xl border px-3 py-3 md:px-3 md:py-2.5 ${
                  variant === "pdf" ? toneClass(item.tone) : "border-border/80 bg-background/60"
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    variant === "pdf" ? iconToneClass(item.tone) : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium">{item.label}</div>
                    {variant === "pdf" && item.tagline ? (
                      <span className="hidden rounded-full bg-background/80 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground md:inline-flex">
                        {item.tagline}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{item.description}</div>
                </div>
                {item.badge ? (
                  <span className="shrink-0 rounded-full border border-border/80 bg-background/80 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {item.badge}
                  </span>
                ) : null}
              </div>
            )
          })()}
        </DropdownMenuItem>
      ))}
    </div>
  )
}

function ExportMenuItems({ onExportChat }: { onExportChat: (request: ChatExportRequest) => void }) {
  return (
    <>
      <ExportSection
        title={"PDF 3\uC885"}
        helper={"\uBC14\uB85C \uC4F0\uB294 PDF \uC800\uC7A5 \uBC29\uC2DD"}
        items={pdfExportItems}
        onExportChat={onExportChat}
        variant="pdf"
      />
      <DropdownMenuSeparator />
      <ExportSection
        title={"\uAE30\uD0C0 2\uC885"}
        helper={"\uD14D\uC2A4\uD2B8 \uACF5\uC720/\uD3B8\uC9D1 \uC6A9\uB3C4"}
        items={otherExportItems}
        onExportChat={onExportChat}
        variant="other"
      />
      <DropdownMenuSeparator />
      <div className="px-3 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {"\uC138\uBD80 \uBC94\uC704\uC640 \uC9C4\uB2E8 \uC635\uC158\uC740 \uD15C\uD50C\uB9BF\uBCC4 \uAE30\uBCF8\uAC12\uC73C\uB85C \uC790\uB3D9 \uC801\uC6A9\uB429\uB2C8\uB2E4."}
      </div>
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
            aria-label={"\uB300\uD654 \uBAA9\uB85D \uC5F4\uAE30"}
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : null}

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-400 text-white shadow-lg">
          <Bot className="h-5 w-5" />
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground md:text-base">{"\uCF54\uBE44\uC804 CS Bot"}</h1>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs text-muted-foreground">{"\uC5F0\uACB0 \uC911"}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 md:gap-2">
        <Link
          href="/search"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:h-9 md:w-9 md:rounded-lg"
          aria-label={"\uAC80\uC0C9"}
          title={"\uAC80\uC0C9"}
        >
          <Search className="h-5 w-5" />
        </Link>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/logs"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={"\uB85C\uADF8 \uB300\uC2DC\uBCF4\uB4DC"}
            title={"\uB85C\uADF8 \uB300\uC2DC\uBCF4\uB4DC"}
          >
            <ScrollText className="h-5 w-5" />
          </Link>

          {onExportChat ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-label={"\uB300\uD654 \uB0B4\uBCF4\uB0B4\uAE30"}
                  title={"\uB300\uD654 \uB0B4\uBCF4\uB0B4\uAE30"}
                  type="button"
                >
                  <Download className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[19rem] max-w-[calc(100vw-1rem)] rounded-2xl p-1.5 md:w-72">
                <ExportMenuItems onExportChat={onExportChat} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <button
            onClick={onToggleDarkMode}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={"\uD14C\uB9C8 \uC804\uD658"}
            title={isDarkMode ? "\uB77C\uC774\uD2B8 \uBAA8\uB4DC\uB85C \uC804\uD658" : "\uB2E4\uD06C \uBAA8\uB4DC\uB85C \uC804\uD658"}
            type="button"
          >
            {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
              aria-label={"\uB354\uBCF4\uAE30 \uBA54\uB274"}
              title={"\uB354\uBCF4\uAE30 \uBA54\uB274"}
              type="button"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[19rem] max-w-[calc(100vw-1rem)] rounded-2xl p-1.5 md:w-72">
            <DropdownMenuLabel>{"\uBE60\uB978 \uBA54\uB274"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/logs" className="flex w-full items-center gap-2">
                <ScrollText className="h-4 w-4" />
                <span>{"\uB85C\uADF8 \uB300\uC2DC\uBCF4\uB4DC"}</span>
              </Link>
            </DropdownMenuItem>
            {onExportChat ? (
              <>
                <DropdownMenuSeparator />
                <ExportMenuItems onExportChat={onExportChat} />
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleDarkMode}>
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{isDarkMode ? "\uB77C\uC774\uD2B8 \uBAA8\uB4DC" : "\uB2E4\uD06C \uBAA8\uB4DC"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
