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
  usageHint?: string
  tone?: "blue" | "violet" | "amber" | "slate" | "emerald"
  previewStyle?: "compact" | "conversation" | "diagnostic" | "brief" | "text" | "markdown"
  icon?: LucideIcon
  tagline?: string
}

const pdfExportItems: ExportMenuItem[] = [
  {
    label: "\uD575\uC2EC PDF",
    description: "\uCEF4\uD329\uD2B8 \u00B7 \uD575\uC2EC \uC548\uB0B4 1\uD398\uC774\uC9C0\uD615",
    request: { format: "pdf", template: "user", scope: "latest_exchange", compactSummary: true },
    badge: "compact",
    usageHint: "\uBE60\uB978 \uC548\uB0B4 \uACF5\uC720",
    tone: "blue",
    previewStyle: "compact",
    icon: MessageSquareText,
    tagline: "\uC0AC\uC6A9\uC790\uC6A9",
  },
  {
    label: "\uC0C1\uB2F4 PDF",
    description: "\uC77C\uBC18\uD615 \u00B7 \uC9C8\uBB38\uACFC \uB2F5\uBCC0 \uD750\uB984 \uC804\uCCB4 \uC815\uB9AC",
    request: { format: "pdf", template: "user", scope: "all", compactSummary: false },
    badge: "\uC77C\uBC18\uD615",
    usageHint: "\uB300\uD654 \uD750\uB984 \uBCF4\uAD00",
    tone: "emerald",
    previewStyle: "conversation",
    icon: FileText,
    tagline: "\uC0AC\uC6A9\uC790\uC6A9",
  },
  {
    label: "\uC6B4\uC601 PDF",
    description: "\uC9C4\uB2E8 \uC815\uBCF4 \u00B7 \uC6B0\uC120\uC21C\uC704 \uC544\uC774\uCF58 \uD3EC\uD568",
    request: { format: "pdf", template: "operator", scope: "all", includeDiagnostics: true },
    usageHint: "\uC9C4\uB2E8 / \uADFC\uAC70 \uAC80\uD1A0",
    tone: "violet",
    previewStyle: "diagnostic",
    icon: ShieldCheck,
    tagline: "\uC6B4\uC601\uC790\uC6A9",
  },
  {
    label: "\uBCF4\uACE0 PDF",
    description: "\uD45C\uC9C0 \uBA54\uD0C0 \uD3EC\uD568 \uBE0C\uB9AC\uD551",
    request: { format: "pdf", template: "report", scope: "latest_exchange" },
    usageHint: "\uACF5\uC720 \uBE0C\uB9AC\uD551 \uBC30\uD3EC",
    tone: "amber",
    previewStyle: "brief",
    icon: Presentation,
    tagline: "\uBCF4\uACE0\uC6A9",
  },
]

const otherExportItems: ExportMenuItem[] = [
  {
    label: "TXT",
    description: "\uC804\uCCB4 \uB300\uD654",
    request: { format: "txt", template: "user", scope: "all" },
    badge: getChatExportFormatLabel("txt"),
    usageHint: "\uBCF5\uC0AC / \uC804\uB2EC",
    tone: "slate",
    previewStyle: "text",
    icon: FileText,
  },
  {
    label: "MD",
    description: "\uBB38\uC11C \uACF5\uC720\uC6A9",
    request: { format: "md", template: "user", scope: "all" },
    badge: getChatExportFormatLabel("md"),
    usageHint: "\uBB38\uC11C \uD3B8\uC9D1 / \uC704\uD0A4",
    tone: "slate",
    previewStyle: "markdown",
    icon: ScrollText,
  },
]

function ExportPreview({
  tone,
  style = "text",
}: {
  tone?: ExportMenuItem["tone"]
  style?: ExportMenuItem["previewStyle"]
}) {
  const frameClass =
    tone === "blue"
      ? "border-blue-200/90 bg-gradient-to-br from-white via-blue-50 to-blue-100/80 dark:border-blue-400/30 dark:from-slate-950 dark:via-blue-950/40 dark:to-slate-900"
      : tone === "emerald"
        ? "border-emerald-200/90 bg-gradient-to-br from-white via-emerald-50 to-teal-100/80 dark:border-emerald-400/30 dark:from-slate-950 dark:via-emerald-950/40 dark:to-slate-900"
        : tone === "violet"
          ? "border-violet-200/90 bg-gradient-to-br from-white via-violet-50 to-fuchsia-100/80 dark:border-violet-400/30 dark:from-slate-950 dark:via-violet-950/40 dark:to-slate-900"
          : tone === "amber"
            ? "border-amber-200/90 bg-gradient-to-br from-white via-amber-50 to-orange-100/80 dark:border-amber-400/30 dark:from-slate-950 dark:via-amber-950/40 dark:to-slate-900"
            : "border-slate-200/90 bg-gradient-to-br from-white via-slate-50 to-slate-100/90 dark:border-slate-600/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800"

  const accentClass =
    tone === "blue"
      ? "bg-blue-500/85"
      : tone === "emerald"
        ? "bg-emerald-500/85"
        : tone === "violet"
          ? "bg-violet-500/85"
          : tone === "amber"
            ? "bg-amber-500/85"
            : "bg-slate-500/80"

  const mutedLine = "rounded-full bg-white/85 dark:bg-white/10"

  return (
    <div className={`relative h-16 w-[4.9rem] shrink-0 overflow-hidden rounded-2xl border ${frameClass}`}>
      <div className={`absolute inset-x-2 top-2 h-1.5 rounded-full ${accentClass}`} />
      {style === "compact" ? (
        <div className="absolute inset-x-2 top-5 space-y-1.5">
          <div className={`h-1.5 w-11/12 ${mutedLine}`} />
          <div className={`h-1.5 w-8/12 ${mutedLine}`} />
          <div className="mt-2 grid grid-cols-2 gap-1">
            <div className="h-5 rounded-lg bg-white/80 dark:bg-white/10" />
            <div className="h-5 rounded-lg bg-white/60 dark:bg-white/5" />
          </div>
        </div>
      ) : null}
      {style === "conversation" ? (
        <div className="absolute inset-x-2 top-5 space-y-1.5">
          <div className="ml-auto h-2 w-8 rounded-full bg-white/80 dark:bg-white/10" />
          <div className="h-5 rounded-xl bg-white/80 dark:bg-white/10" />
          <div className="ml-3 h-4 rounded-xl bg-white/60 dark:bg-white/5" />
        </div>
      ) : null}
      {style === "diagnostic" ? (
        <div className="absolute inset-x-2 top-5">
          <div className="grid grid-cols-3 gap-1.5">
            <div className="h-6 rounded-lg bg-emerald-400/75 dark:bg-emerald-500/30" />
            <div className="h-6 rounded-lg bg-amber-400/75 dark:bg-amber-500/30" />
            <div className="h-6 rounded-lg bg-rose-400/75 dark:bg-rose-500/30" />
          </div>
          <div className={`mt-2 h-1.5 w-10/12 ${mutedLine}`} />
          <div className={`mt-1 h-1.5 w-7/12 ${mutedLine}`} />
        </div>
      ) : null}
      {style === "brief" ? (
        <div className="absolute inset-x-2 top-5">
          <div className="rounded-xl border border-white/70 bg-white/75 px-2 py-1.5 dark:border-white/10 dark:bg-white/5">
            <div className={`h-1.5 w-9/12 ${mutedLine}`} />
            <div className={`mt-1 h-1.5 w-11/12 ${mutedLine}`} />
            <div className={`mt-1 h-1.5 w-7/12 ${mutedLine}`} />
          </div>
          <div className="mt-2 flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-blue-500/80" />
            <div className={`h-1.5 w-8 ${mutedLine}`} />
          </div>
        </div>
      ) : null}
      {style === "text" ? (
        <div className="absolute inset-x-2 top-5 space-y-1.5">
          <div className={`h-1.5 w-11/12 ${mutedLine}`} />
          <div className={`h-1.5 w-10/12 ${mutedLine}`} />
          <div className={`h-1.5 w-9/12 ${mutedLine}`} />
          <div className={`h-1.5 w-7/12 ${mutedLine}`} />
        </div>
      ) : null}
      {style === "markdown" ? (
        <div className="absolute inset-x-2 top-5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-slate-500/75 dark:bg-slate-300/40" />
            <div className={`h-1.5 w-9 ${mutedLine}`} />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-slate-500/75 dark:bg-slate-300/40" />
            <div className={`h-1.5 w-11 ${mutedLine}`} />
          </div>
          <div className="mt-2 rounded-lg bg-white/75 px-2 py-1.5 dark:bg-white/5">
            <div className={`h-1.5 w-full ${mutedLine}`} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

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
    if (tone === "emerald") return "border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-teal-100/70 shadow-[0_8px_24px_rgba(16,185,129,0.10)] dark:border-emerald-500/30 dark:bg-emerald-500/10"
    if (tone === "violet") return "border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-fuchsia-100/70 shadow-[0_8px_24px_rgba(139,92,246,0.10)] dark:border-violet-500/30 dark:bg-violet-500/10"
    if (tone === "amber") return "border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-100/70 shadow-[0_8px_24px_rgba(245,158,11,0.10)] dark:border-amber-500/30 dark:bg-amber-500/10"
    return "border-border bg-muted/40"
  }

  const iconToneClass = (tone?: ExportMenuItem["tone"]) => {
    if (tone === "blue") return "border border-blue-200 bg-white shadow-sm shadow-blue-200/80"
    if (tone === "emerald") return "border border-emerald-200 bg-white shadow-sm shadow-emerald-200/80"
    if (tone === "violet") return "border border-violet-200 bg-white shadow-sm shadow-violet-200/80"
    if (tone === "amber") return "border border-amber-200 bg-white shadow-sm shadow-amber-200/80"
    return "border border-border bg-background text-muted-foreground"
  }

  const iconGlyphToneClass = (tone?: ExportMenuItem["tone"]) => {
    if (tone === "blue") return "text-blue-600"
    if (tone === "emerald") return "text-emerald-600"
    if (tone === "violet") return "text-violet-600"
    if (tone === "amber") return "text-amber-600"
    return "text-muted-foreground"
  }

  const cardTitleClass = (variant: "pdf" | "other") =>
    variant === "pdf" ? "text-slate-900" : "text-foreground"

  const cardBodyClass = (variant: "pdf" | "other") =>
    variant === "pdf" ? "text-slate-600" : "text-muted-foreground"

  const cardBadgeClass = (variant: "pdf" | "other") =>
    variant === "pdf"
      ? "border-slate-300/90 bg-white/90 text-slate-600"
      : "border-border/80 bg-background/85 text-muted-foreground"

  const cardDividerClass = (variant: "pdf" | "other") =>
    variant === "pdf" ? "bg-slate-300/80" : "bg-border/60"

  const cardHintPillClass = (variant: "pdf" | "other") =>
    variant === "pdf" ? "bg-slate-900/5 text-slate-600" : "bg-foreground/5 text-muted-foreground"

  return (
    <div className="space-y-1">
      <DropdownMenuLabel className="px-3 pt-1">{title}</DropdownMenuLabel>
      <div className="px-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">{helper}</div>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.label}
          onClick={() => onExportChat(item.request)}
          className="min-h-0 cursor-pointer whitespace-normal rounded-2xl px-1 py-1.5 touch-manipulation focus:bg-transparent data-[highlighted]:bg-transparent sm:px-1.5"
        >
          {(() => {
            const Icon = item.icon ?? FileText
            return (
              <div
                className={`flex min-h-[6.75rem] w-full min-w-0 items-start gap-3.5 rounded-[1.35rem] border px-4 py-3.5 ${
                  variant === "pdf" ? toneClass(item.tone) : "border-border/80 bg-background/60"
                } sm:min-h-[6.25rem] sm:gap-3 sm:px-3.5 sm:py-3`}
              >
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <div
                    className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                      variant === "pdf" ? iconToneClass(item.tone) : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${variant === "pdf" ? iconGlyphToneClass(item.tone) : "text-muted-foreground"}`} strokeWidth={2.3} />
                  </div>
                  <ExportPreview tone={item.tone} style={item.previewStyle} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className={`min-w-0 flex-1 text-sm font-semibold leading-snug ${cardTitleClass(variant)}`}>{item.label}</div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {item.tagline ? (
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-[0.04em] ${cardBadgeClass(variant)}`}>
                          {item.tagline}
                        </span>
                      ) : null}
                      {item.badge ? (
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-[0.04em] ${cardBadgeClass(variant)}`}>
                          {item.badge}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className={`mt-1.5 text-[11px] leading-relaxed ${cardBodyClass(variant)}`}>{item.description}</div>
                  <div className={`mt-2 h-px w-full ${cardDividerClass(variant)}`} />
                  <div className={`mt-2 text-[10px] leading-relaxed ${cardBodyClass(variant)}`}>
                    {item.usageHint
                      ? `${item.usageHint}용`
                      : variant === "pdf"
                        ? "PDF로 바로 저장하거나 공유할 때 적합합니다."
                        : "복사, 편집, 문서 공유에 적합합니다."}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-medium ${cardHintPillClass(variant)}`}>
                      {variant === "pdf" ? "저장용" : "편집용"}
                    </span>
                  </div>
                </div>
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
        title={"PDF 4\uC885"}
        helper={"\uC6A9\uB3C4\uC5D0 \uB9DE\uAC8C \uACE0\uB974\uB294 PDF \uC800\uC7A5 \uBC29\uC2DD"}
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
              <DropdownMenuContent
                align="end"
                className="max-h-[min(80vh,42rem)] w-[20rem] max-w-[calc(100vw-0.75rem)] overflow-y-auto rounded-2xl p-1.5 sm:w-[21.5rem] md:w-[22rem]"
              >
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
          <DropdownMenuContent
            align="end"
            className="max-h-[min(80vh,42rem)] w-[20rem] max-w-[calc(100vw-0.75rem)] overflow-y-auto rounded-2xl p-1.5 sm:w-[21.5rem] md:w-[22rem]"
          >
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
