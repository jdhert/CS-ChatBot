"use client"

import { type FormEvent, type ReactNode, useMemo, useState } from "react"
import { Check, Loader2, MessageSquarePlus, Pencil, Search, Trash2, X } from "lucide-react"
import { groupConversationsByDate, type Conversation } from "@/lib/conversations"
import { cn } from "@/lib/utils"

const SEARCH_PREVIEW_BEFORE = 18
const SEARCH_PREVIEW_AFTER = 34

const ANSWER_SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  manual: {
    label: "매뉴얼",
    className: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  llm: {
    label: "LLM",
    className: "border-primary/20 bg-primary/10 text-primary",
  },
  deterministic_fallback: {
    label: "이력",
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  no_match: {
    label: "미매칭",
    className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
}

function highlightText(text: string, normalizedSearch: string): ReactNode {
  if (!normalizedSearch) return text

  const lowerText = text.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let matchIndex = lowerText.indexOf(normalizedSearch)

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex))
    }

    const endIndex = matchIndex + normalizedSearch.length
    parts.push(
      <mark
        key={`${matchIndex}-${endIndex}`}
        className="rounded bg-yellow-200 px-0.5 text-yellow-950 dark:bg-yellow-500/30 dark:text-yellow-100"
      >
        {text.slice(matchIndex, endIndex)}
      </mark>,
    )

    cursor = endIndex
    matchIndex = lowerText.indexOf(normalizedSearch, cursor)
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts.length > 0 ? parts : text
}

function buildSearchPreview(conversation: Conversation, normalizedSearch: string): string | null {
  if (!normalizedSearch) return null

  const matchedMessage = conversation.messages.find((message) =>
    message.content.toLowerCase().includes(normalizedSearch),
  )
  if (matchedMessage) {
    const normalizedContent = matchedMessage.content.replace(/\s+/g, " ").trim()
    const matchIndex = normalizedContent.toLowerCase().indexOf(normalizedSearch)
    if (matchIndex === -1) return null

    const startIndex = Math.max(0, matchIndex - SEARCH_PREVIEW_BEFORE)
    const endIndex = Math.min(
      normalizedContent.length,
      matchIndex + normalizedSearch.length + SEARCH_PREVIEW_AFTER,
    )

    return `${startIndex > 0 ? "..." : ""}${normalizedContent.slice(startIndex, endIndex)}${
      endIndex < normalizedContent.length ? "..." : ""
    }`
  }

  if (conversation.title.toLowerCase().includes(normalizedSearch)) {
    return "제목에서 일치"
  }

  return null
}

function getConversationBadge(conversation: Conversation) {
  const lastBotMessage = [...conversation.messages].reverse().find((message) => message.sender === "bot")
  if (!lastBotMessage?.answerSource) return null
  return ANSWER_SOURCE_BADGE[lastBotMessage.answerSource] ?? null
}

function formatConversationTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface ConversationsPanelProps {
  conversations: Conversation[]
  activeConversationId: string | null
  deletingConversationIds?: Set<string>
  renamingConversationIds?: Set<string>
  isHydratingConversations?: boolean
  conversationSyncError?: string | null
  lastConversationSyncAt?: string | null
  searchQuery?: string
  isSearchingConversations?: boolean
  conversationSearchError?: string | null
  hasMoreConversations?: boolean
  isLoadingMoreConversations?: boolean
  conversationPaginationError?: string | null
  onSelectConversation: (conversationId: string) => void
  onNewConversation: () => void
  onDeleteConversation: (conversationId: string) => void
  onRenameConversation?: (conversationId: string, title: string) => Promise<void>
  onSearchQueryChange?: (query: string) => void
  onLoadMoreConversations?: () => void
  onClose?: () => void
}

export function ConversationsPanel({
  conversations,
  activeConversationId,
  deletingConversationIds,
  renamingConversationIds,
  isHydratingConversations = false,
  conversationSyncError,
  lastConversationSyncAt,
  searchQuery = "",
  isSearchingConversations = false,
  conversationSearchError,
  hasMoreConversations = false,
  isLoadingMoreConversations = false,
  conversationPaginationError,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onSearchQueryChange,
  onLoadMoreConversations,
  onClose,
}: ConversationsPanelProps) {
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const trimmedSearch = searchQuery.trim().toLowerCase()
  const filteredConversations = useMemo(() => {
    if (!trimmedSearch) return conversations
    return conversations.filter((conversation) => {
      const searchable = [
        conversation.title,
        ...conversation.messages.map((message) => message.content),
      ]
        .join(" ")
        .toLowerCase()
      return searchable.includes(trimmedSearch)
    })
  }, [conversations, trimmedSearch])
  const groupedConversations = groupConversationsByDate(filteredConversations)
  const syncStatusText = isHydratingConversations
    ? "대화 이력을 동기화하고 있습니다"
    : conversationSyncError
      ? "로컬 대화 목록으로 동작 중"
      : lastConversationSyncAt
        ? `동기화 완료 ${new Date(lastConversationSyncAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
        : "대화 이력 준비됨"

  const startEditingTitle = (conversation: Conversation) => {
    setEditingConversationId(conversation.id)
    setEditingTitle(conversation.title)
  }

  const cancelEditingTitle = () => {
    setEditingConversationId(null)
    setEditingTitle("")
  }

  const submitEditingTitle = async (event: FormEvent<HTMLFormElement>, conversation: Conversation) => {
    event.preventDefault()
    const title = editingTitle.trim()
    if (!title || title === conversation.title || !onRenameConversation) {
      cancelEditingTitle()
      return
    }

    try {
      await onRenameConversation(conversation.id, title)
      cancelEditingTitle()
    } catch {
      // Hook already surfaces the error with toast and sync status.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] md:pt-4">
        <div className="flex items-center gap-2">
          {onClose ? (
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
              aria-label="사이드바 닫기"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <h2 className="text-sm font-semibold text-foreground">대화 목록</h2>
        </div>
        <button
          onClick={onNewConversation}
          className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          type="button"
        >
          <MessageSquarePlus className="h-4 w-4" />
          새 대화
        </button>
      </div>

      <div className="shrink-0 border-b border-border p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
            placeholder="대화 제목/내용 검색"
            className="h-9 w-full rounded-xl border border-border bg-background pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchQueryChange?.("")}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="검색어 지우기"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>
        {trimmedSearch ? (
          <div className="mt-2 text-[11px] text-muted-foreground">
            {isSearchingConversations
              ? "서버 대화 이력까지 검색 중입니다..."
              : `${filteredConversations.length.toLocaleString()}개 대화가 검색되었습니다.`}
          </div>
        ) : null}
        {conversationSearchError ? (
          <div className="mt-1 line-clamp-2 text-[11px] text-amber-600 dark:text-amber-400">
            서버 검색 실패: {conversationSearchError}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquarePlus className="mb-3 h-12 w-12 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">아직 대화가 없습니다.</p>
            <p className="mt-1 text-xs text-muted-foreground">새 대화를 시작해 보세요.</p>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="mb-3 h-10 w-10 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
            <p className="mt-1 text-xs text-muted-foreground">다른 제목이나 오류 문구로 찾아보세요.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedConversations.map(({ label, conversations: groupConversations }) => (
              <div key={label}>
                <div className="mb-2 flex items-center justify-between px-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
                  <span className="text-[10px] text-muted-foreground">{groupConversations.length}건</span>
                </div>
                <div className="space-y-1">
                  {groupConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId
                    const isDeleting = deletingConversationIds?.has(conversation.id) ?? false
                    const isRenaming = renamingConversationIds?.has(conversation.id) ?? false
                    const isEditing = editingConversationId === conversation.id
                    const searchPreview = buildSearchPreview(conversation, trimmedSearch)
                    const badge = getConversationBadge(conversation)

                    return (
                      <div
                        key={conversation.id}
                        className={cn(
                          "group relative flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all",
                          isActive
                            ? "border border-primary/15 bg-primary/10 text-primary"
                            : "border border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        {isEditing ? (
                          <form
                            className="flex min-w-0 flex-1 items-center gap-1"
                            onSubmit={(event) => submitEditingTitle(event, conversation)}
                          >
                            <input
                              value={editingTitle}
                              onChange={(event) => setEditingTitle(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault()
                                  cancelEditingTitle()
                                }
                              }}
                              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                              maxLength={80}
                              autoFocus
                            />
                            <button
                              type="submit"
                              disabled={isRenaming || !editingTitle.trim()}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:cursor-wait disabled:opacity-60"
                              aria-label="대화 제목 저장"
                            >
                              {isRenaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingTitle}
                              disabled={isRenaming}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                              aria-label="대화 제목 수정 취소"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        ) : (
                          <button
                            onClick={() => onSelectConversation(conversation.id)}
                            className="flex-1 overflow-hidden text-left disabled:cursor-wait"
                            disabled={isDeleting || isRenaming}
                            type="button"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="truncate text-sm font-medium">
                                {highlightText(conversation.title, trimmedSearch)}
                              </p>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {formatConversationTime(conversation.updatedAt)}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              {badge ? (
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                    badge.className,
                                  )}
                                >
                                  {badge.label}
                                </span>
                              ) : null}
                              <span className="text-[10px] opacity-70">{conversation.messages.length}개 메시지</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs opacity-70">
                              {isDeleting
                                ? "서버와 로컬 목록에서 삭제 중입니다..."
                                : isRenaming
                                  ? "제목 변경 중입니다..."
                                  : searchPreview
                                    ? highlightText(searchPreview, trimmedSearch)
                                    : conversation.messages.at(-1)?.content ?? "메시지가 아직 없습니다."}
                            </p>
                          </button>
                        )}
                        {!isEditing && onRenameConversation ? (
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              startEditingTitle(conversation)
                            }}
                            className="shrink-0 rounded-lg p-2 opacity-100 transition-all hover:bg-accent md:p-1.5 md:opacity-0 md:group-hover:opacity-100"
                            disabled={isDeleting || isRenaming}
                            type="button"
                            title="대화 제목 수정"
                          >
                            {isRenaming ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground transition-colors hover:text-primary" />
                            )}
                          </button>
                        ) : null}
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteConversation(conversation.id)
                          }}
                          className={cn(
                            "shrink-0 rounded-lg p-2 transition-all md:p-1.5",
                            isDeleting ? "opacity-70" : "opacity-100 md:opacity-0 md:group-hover:opacity-100",
                            "hover:bg-destructive/10",
                          )}
                          disabled={isDeleting || isRenaming || isEditing}
                          type="button"
                          title={isDeleting ? "삭제 중" : "대화 삭제"}
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground transition-colors hover:text-destructive" />
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {hasMoreConversations ? (
              <button
                type="button"
                onClick={onLoadMoreConversations}
                disabled={isLoadingMoreConversations || !onLoadMoreConversations}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-60"
              >
                {isLoadingMoreConversations ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {trimmedSearch ? "검색 결과 더 보기" : "이전 대화 더 보기"}
              </button>
            ) : null}
            {conversationPaginationError ? (
              <p className="px-2 text-[11px] text-amber-600 dark:text-amber-400">
                더 불러오기 실패: {conversationPaginationError}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-card px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 md:py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            {isHydratingConversations ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" /> : null}
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                conversationSyncError ? "bg-amber-500" : isHydratingConversations ? "bg-blue-500" : "bg-green-500",
              )}
            />
          </span>
          <span className="truncate">{syncStatusText}</span>
        </div>
        {conversationSyncError ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-amber-600 dark:text-amber-400">
            {conversationSyncError}
          </p>
        ) : null}
      </div>
    </div>
  )
}
