"use client"

import { useEffect, useState } from "react"
import { ChatArea } from "@/components/chatbot/chat-area"
import { ConversationsPanel } from "@/components/chatbot/conversations-panel"
import { useChat } from "@/hooks/use-chat"
import { useConversations } from "@/hooks/use-conversations"

export default function ChatbotPage() {
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const {
    conversations,
    activeConversationId,
    currentMessages,
    browserUserKey,
    deletingConversationIds,
    renamingConversationIds,
    isHydratingConversations,
    conversationSyncError,
    lastConversationSyncAt,
    conversationSearchQuery,
    isSearchingConversations,
    conversationSearchError,
    hasMoreConversations,
    isLoadingMoreConversations,
    conversationPaginationError,
    setCurrentMessages,
    setConversationSearchQuery,
    startNewConversation,
    ensureConversation,
    selectConversation,
    removeConversation,
    renameConversation,
    loadMoreConversations,
  } = useConversations()

  const {
    isTyping,
    inputPrefill,
    submitMessage,
    handleRetry,
    handleEditQuestion,
    handleExportChat,
  } = useChat({
    activeConversationId,
    currentMessages,
    setCurrentMessages,
    ensureConversation,
    browserUserKey,
  })

  useEffect(() => {
    const saved = localStorage.getItem("darkMode") === "true"
    if (saved) setIsDarkMode(true)
  }, [])

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
    localStorage.setItem("darkMode", String(isDarkMode))
  }, [isDarkMode])

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={[
          "fixed inset-y-0 left-0 z-50 w-[min(88vw,20rem)] border-r border-border bg-card shadow-2xl transition-transform duration-200 ease-out",
          "md:relative md:z-auto md:w-64 md:translate-x-0 md:shadow-none",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <ConversationsPanel
          conversations={conversations}
          activeConversationId={activeConversationId}
          deletingConversationIds={deletingConversationIds}
          renamingConversationIds={renamingConversationIds}
          isHydratingConversations={isHydratingConversations}
          conversationSyncError={conversationSyncError}
          lastConversationSyncAt={lastConversationSyncAt}
          searchQuery={conversationSearchQuery}
          isSearchingConversations={isSearchingConversations}
          conversationSearchError={conversationSearchError}
          hasMoreConversations={hasMoreConversations}
          isLoadingMoreConversations={isLoadingMoreConversations}
          conversationPaginationError={conversationPaginationError}
          onSelectConversation={(id) => {
            selectConversation(id)
            setIsSidebarOpen(false)
          }}
          onNewConversation={() => {
            startNewConversation()
            setIsSidebarOpen(false)
          }}
          onDeleteConversation={removeConversation}
          onRenameConversation={renameConversation}
          onSearchQueryChange={setConversationSearchQuery}
          onLoadMoreConversations={loadMoreConversations}
          onClose={() => setIsSidebarOpen(false)}
        />
      </div>

      <main className="min-w-0 flex-1 overflow-hidden">
        <ChatArea
          messages={currentMessages}
          isTyping={isTyping}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          onSendMessage={submitMessage}
          onExportChat={handleExportChat}
          onRetry={handleRetry}
          onEditQuestion={handleEditQuestion}
          inputPrefill={inputPrefill}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />
      </main>
    </div>
  )
}
