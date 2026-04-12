"use client"

import { useMemo } from "react"
import { Loader2, MessageSquarePlus, Search, Trash2, X } from "lucide-react"
import { groupConversationsByDate, type Conversation } from "@/lib/conversations"
import { cn } from "@/lib/utils"

interface ConversationsPanelProps {
  conversations: Conversation[]
  activeConversationId: string | null
  deletingConversationIds?: Set<string>
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
  onSearchQueryChange?: (query: string) => void
  onLoadMoreConversations?: () => void
  onClose?: () => void
}

export function ConversationsPanel({
  conversations,
  activeConversationId,
  deletingConversationIds,
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
  onSearchQueryChange,
  onLoadMoreConversations,
  onClose,
}: ConversationsPanelProps) {
  const trimmedSearch = searchQuery.trim().toLowerCase()
  const filteredConversations = useMemo(() => {
    if (!trimmedSearch) return conversations
    return conversations.filter((conversation) => {
      const searchable = [
        conversation.title,
        ...conversation.messages.map((message) => message.content),
      ].join(" ").toLowerCase()
      return searchable.includes(trimmedSearch)
    })
  }, [conversations, trimmedSearch])
  const groupedConversations = groupConversationsByDate(filteredConversations)
  const syncStatusText = isHydratingConversations
    ? "대화 이력 동기화 중"
    : conversationSyncError
      ? "로컬 대화 이력 사용 중"
      : lastConversationSyncAt
        ? `동기화 완료 ${new Date(lastConversationSyncAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
        : "대화 이력 준비됨"

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
              aria-label="사이드바 닫기"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}
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

      <div className="border-b border-border p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
            placeholder="대화 제목/내용 검색"
            className="h-9 w-full rounded-xl border border-border bg-background pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange?.("")}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="검색어 지우기"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </label>
        {trimmedSearch && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            {isSearchingConversations
              ? "서버 대화 이력까지 검색 중..."
              : `${filteredConversations.length.toLocaleString()}개 대화가 검색되었습니다.`}
          </div>
        )}
        {conversationSearchError && (
          <div className="mt-1 line-clamp-2 text-[11px] text-amber-600 dark:text-amber-400">
            서버 검색 실패: {conversationSearchError}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquarePlus className="mb-3 h-12 w-12 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">아직 대화가 없습니다.</p>
            <p className="mt-1 text-xs text-muted-foreground">새 대화를 시작해보세요.</p>
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
                <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </h3>
                <div className="space-y-1">
                  {groupConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId
                    const isDeleting = deletingConversationIds?.has(conversation.id) ?? false
                    return (
                      <div
                        key={conversation.id}
                        className={cn(
                          "group relative flex items-center gap-2 rounded-lg px-3 py-2 transition-all",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        <button
                          onClick={() => onSelectConversation(conversation.id)}
                          className="flex-1 overflow-hidden text-left disabled:cursor-wait"
                          disabled={isDeleting}
                          type="button"
                        >
                          <p className="truncate text-sm font-medium">{conversation.title}</p>
                          <p className="mt-0.5 truncate text-xs opacity-70">
                            {isDeleting ? "서버와 로컬에서 삭제 중..." : `${conversation.messages.length}개 메시지`}
                          </p>
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteConversation(conversation.id)
                          }}
                          className={cn(
                            "shrink-0 rounded-md p-1.5 transition-all",
                            isDeleting ? "opacity-70" : "opacity-0 group-hover:opacity-100",
                            "hover:bg-destructive/10",
                          )}
                          disabled={isDeleting}
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
            {hasMoreConversations && (
              <button
                type="button"
                onClick={onLoadMoreConversations}
                disabled={isLoadingMoreConversations || !onLoadMoreConversations}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-wait disabled:opacity-60"
              >
                {isLoadingMoreConversations && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {trimmedSearch ? "검색 결과 더 보기" : "이전 대화 더 보기"}
              </button>
            )}
            {conversationPaginationError && (
              <p className="px-2 text-[11px] text-amber-600 dark:text-amber-400">
                더 보기 실패: {conversationPaginationError}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            {isHydratingConversations && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />}
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                conversationSyncError ? "bg-amber-500" : isHydratingConversations ? "bg-blue-500" : "bg-green-500",
              )}
            />
          </span>
          <span className="truncate">{syncStatusText}</span>
        </div>
        {conversationSyncError && (
          <p className="mt-1 line-clamp-2 text-[11px] text-amber-600 dark:text-amber-400">
            {conversationSyncError}
          </p>
        )}
      </div>
    </div>
  )
}
