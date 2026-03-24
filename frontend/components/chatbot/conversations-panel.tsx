"use client"

import { MessageSquarePlus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Conversation } from "@/lib/conversations"
import { groupConversationsByDate } from "@/lib/conversations"

interface ConversationsPanelProps {
  conversations: Conversation[]
  activeConversationId: string | null
  onSelectConversation: (conversationId: string) => void
  onNewConversation: () => void
  onDeleteConversation: (conversationId: string) => void
}

export function ConversationsPanel({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}: ConversationsPanelProps) {
  const groupedConversations = groupConversationsByDate(conversations)
  const groups = ["오늘", "어제", "지난 7일", "이전"]

  return (
    <div className="flex h-full flex-col bg-card">
      {/* 헤더 */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">대화 목록</h2>
        <button
          onClick={onNewConversation}
          className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          type="button"
        >
          <MessageSquarePlus className="h-4 w-4" />
          새 대화
        </button>
      </div>

      {/* 대화 목록 */}
      <div className="flex-1 overflow-y-auto p-3">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquarePlus className="mb-3 h-12 w-12 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">아직 대화가 없습니다.</p>
            <p className="mt-1 text-xs text-muted-foreground">새 대화를 시작해보세요!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((groupName) => {
              const groupConversations = groupedConversations.get(groupName)
              if (!groupConversations || groupConversations.length === 0) {
                return null
              }

              return (
                <div key={groupName}>
                  <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupName}
                  </h3>
                  <div className="space-y-1">
                    {groupConversations.map((conversation) => {
                      const isActive = conversation.id === activeConversationId
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
                            className="flex-1 overflow-hidden text-left"
                            type="button"
                          >
                            <p className="truncate text-sm font-medium">{conversation.title}</p>
                            <p className="mt-0.5 truncate text-xs opacity-70">
                              {conversation.messages.length}개 메시지
                            </p>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteConversation(conversation.id)
                            }}
                            className={cn(
                              "shrink-0 rounded-md p-1.5 transition-all",
                              "opacity-0 group-hover:opacity-100",
                              "hover:bg-destructive/10",
                            )}
                            type="button"
                            title="대화 삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground transition-colors hover:text-destructive" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 온라인 상태 표시 */}
      <div className="border-t border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
          </span>
          <span>AI 코어 온라인</span>
        </div>
      </div>
    </div>
  )
}
