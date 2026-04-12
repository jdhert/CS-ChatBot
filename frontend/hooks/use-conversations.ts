import { useCallback, useEffect, useState } from "react"
import { toast } from "@/hooks/use-toast"
import type { Message } from "@/components/chatbot/chat-message"
import type { Conversation } from "@/lib/conversations"
import {
  clearActiveSessionId,
  createNewConversation,
  deleteConversation,
  deleteConversationFromServer,
  fetchConversationsFromServer,
  generateConversationTitle,
  getBrowserUserKey,
  loadActiveSessionId,
  loadConversations,
  mergeConversations,
  saveActiveSessionId,
  saveConversations,
  updateConversation,
} from "@/lib/conversations"

function isConversationSettled(messages: Message[]): boolean {
  if (messages.length === 0) return false
  const lastMessage = messages[messages.length - 1]
  if (lastMessage.sender !== "bot") return false
  return !["searching", "generating", "streaming"].includes(lastMessage.status ?? "")
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [currentMessages, setCurrentMessages] = useState<Message[]>([])
  const [browserUserKey, setBrowserUserKey] = useState<string | null>(null)
  const [deletingConversationIds, setDeletingConversationIds] = useState<Set<string>>(() => new Set())
  const [isHydratingConversations, setIsHydratingConversations] = useState(true)
  const [conversationSyncError, setConversationSyncError] = useState<string | null>(null)
  const [lastConversationSyncAt, setLastConversationSyncAt] = useState<string | null>(null)
  const [conversationSearchQuery, setConversationSearchQuery] = useState("")
  const [isSearchingConversations, setIsSearchingConversations] = useState(false)
  const [conversationSearchError, setConversationSearchError] = useState<string | null>(null)

  const applyConversationSelection = useCallback((nextConversations: Conversation[], preferredId?: string | null) => {
    if (nextConversations.length === 0) {
      setActiveConversationId(null)
      setCurrentMessages([])
      return
    }

    const selected =
      (preferredId ? nextConversations.find((conv) => conv.id === preferredId) : null) ?? nextConversations[0]

    setActiveConversationId(selected.id)
    setCurrentMessages(selected.messages)
    saveActiveSessionId(selected.id)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function hydrateConversations() {
      setIsHydratingConversations(true)
      setConversationSyncError(null)
      const localConversations = loadConversations()
      const savedActiveId = loadActiveSessionId()
      const stableUserKey = getBrowserUserKey()

      setBrowserUserKey(stableUserKey)

      if (localConversations.length > 0) {
        setConversations(localConversations)
        applyConversationSelection(localConversations, savedActiveId)
      }

      try {
        const serverConversations = await fetchConversationsFromServer(stableUserKey)
        if (cancelled) return

        setConversationSyncError(null)
        setLastConversationSyncAt(new Date().toISOString())

        if (serverConversations.length > 0) {
          const mergedConversations = mergeConversations(localConversations, serverConversations)
          setConversations(mergedConversations)
          saveConversations(mergedConversations)
          applyConversationSelection(mergedConversations, savedActiveId)
          return
        }
      } catch (error) {
        console.warn("Failed to hydrate conversations from server:", error)
        if (!cancelled) {
          setConversationSyncError(error instanceof Error ? error.message : "서버 대화 이력을 불러오지 못했습니다")
        }
      }

      if (!cancelled && localConversations.length > 0) {
        setConversations(localConversations)
        applyConversationSelection(localConversations, savedActiveId)
      }
    }

    void hydrateConversations().finally(() => {
      if (!cancelled) {
        setIsHydratingConversations(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [applyConversationSelection])

  useEffect(() => {
    if (!browserUserKey) {
      return
    }

    const search = conversationSearchQuery.trim()
    if (search.length < 2) {
      setConversationSearchError(null)
      setIsSearchingConversations(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setIsSearchingConversations(true)
      setConversationSearchError(null)

      try {
        const serverConversations = await fetchConversationsFromServer(browserUserKey, {
          search,
          includeMessages: true,
          limit: 100,
        })
        if (cancelled) return

        setConversationSyncError(null)
        setLastConversationSyncAt(new Date().toISOString())
        setConversations((prev) => {
          const next = mergeConversations(prev, serverConversations, 100)
          saveConversations(next)
          return next
        })
      } catch (error) {
        console.warn("Failed to search conversations from server:", error)
        if (!cancelled) {
          setConversationSearchError(error instanceof Error ? error.message : "서버 대화 이력을 검색하지 못했습니다")
        }
      } finally {
        if (!cancelled) {
          setIsSearchingConversations(false)
        }
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [browserUserKey, conversationSearchQuery])

  useEffect(() => {
    if (!activeConversationId || currentMessages.length === 0 || !isConversationSettled(currentMessages)) {
      return
    }

    setConversations((prev) => {
      const existingConv = prev.find((conv) => conv.id === activeConversationId)
      const shouldUpdateTitle = !existingConv?.title || existingConv.title === "새 대화"
      const title = shouldUpdateTitle
        ? generateConversationTitle(currentMessages[0]?.content ?? "새 대화")
        : existingConv.title

      const updatedConv: Conversation = {
        id: activeConversationId,
        title,
        messages: currentMessages,
        createdAt: existingConv?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const next = updateConversation(prev, updatedConv)
      saveConversations(next)
      return next
    })
  }, [activeConversationId, currentMessages])

  const startNewConversation = useCallback(() => {
    const existingEmpty = conversations.find((conv) => conv.messages.length === 0)
    if (existingEmpty) {
      setActiveConversationId(existingEmpty.id)
      setCurrentMessages([])
      saveActiveSessionId(existingEmpty.id)
      return existingEmpty.id
    }

    const newConv = createNewConversation()
    setActiveConversationId(newConv.id)
    setCurrentMessages([])
    saveActiveSessionId(newConv.id)

    const next = [newConv, ...conversations]
    setConversations(next)
    saveConversations(next)
    return newConv.id
  }, [conversations])

  const ensureConversation = useCallback(
    (firstMessage?: string) => {
      if (activeConversationId) {
        return activeConversationId
      }

      const newConv = createNewConversation(firstMessage)
      setActiveConversationId(newConv.id)
      setCurrentMessages([])
      saveActiveSessionId(newConv.id)

      const next = [newConv, ...conversations]
      setConversations(next)
      saveConversations(next)
      return newConv.id
    },
    [activeConversationId, conversations],
  )

  const selectConversation = useCallback(
    (conversationId: string) => {
      setActiveConversationId(conversationId)
      saveActiveSessionId(conversationId)
      const selectedConv = conversations.find((conv) => conv.id === conversationId)
      if (selectedConv) {
        setCurrentMessages(selectedConv.messages)
      }
    },
    [conversations],
  )

  const removeConversation = useCallback(
    async (conversationId: string) => {
      if (deletingConversationIds.has(conversationId)) {
        return
      }

      const targetConversation = conversations.find((conv) => conv.id === conversationId)
      if (!targetConversation) {
        return
      }

      setDeletingConversationIds((prev) => new Set(prev).add(conversationId))

      try {
        if (targetConversation.messages.length > 0) {
          await deleteConversationFromServer(conversationId, browserUserKey)
          setLastConversationSyncAt(new Date().toISOString())
        }
        setConversationSyncError(null)
      } catch (error) {
        setConversationSyncError(error instanceof Error ? error.message : "대화를 삭제하지 못했습니다")
        toast({
          title: "대화를 삭제하지 못했습니다",
          description: error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.",
          variant: "destructive",
        })
        return
      } finally {
        setDeletingConversationIds((prev) => {
          const next = new Set(prev)
          next.delete(conversationId)
          return next
        })
      }

      const next = deleteConversation(conversations, conversationId)
      setConversations(next)
      saveConversations(next)

      if (conversationId !== activeConversationId) {
        toast({ title: "대화를 삭제했습니다", description: "서버와 로컬 대화 목록을 동기화했습니다." })
        return
      }

      if (next.length > 0) {
        const nextConv = next[0]
        setActiveConversationId(nextConv.id)
        setCurrentMessages(nextConv.messages)
        saveActiveSessionId(nextConv.id)
        toast({ title: "대화를 삭제했습니다", description: "다음 대화로 이동했습니다." })
        return
      }

      setActiveConversationId(null)
      setCurrentMessages([])
      clearActiveSessionId()
      toast({ title: "대화를 삭제했습니다", description: "대화 목록이 비었습니다." })
    },
    [activeConversationId, browserUserKey, conversations, deletingConversationIds],
  )

  return {
    conversations,
    activeConversationId,
    currentMessages,
    browserUserKey,
    deletingConversationIds,
    isHydratingConversations,
    conversationSyncError,
    lastConversationSyncAt,
    conversationSearchQuery,
    isSearchingConversations,
    conversationSearchError,
    setCurrentMessages,
    setActiveConversationId,
    setConversationSearchQuery,
    startNewConversation,
    ensureConversation,
    selectConversation,
    removeConversation,
  }
}
