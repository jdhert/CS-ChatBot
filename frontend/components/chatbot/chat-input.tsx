"use client"

import { useState, type KeyboardEvent } from "react"
import { Paperclip, Send } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState("")

  function handleSend() {
    if (message.trim() && !disabled) {
      onSend(message.trim())
      setMessage("")
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-border bg-card p-4">
      <div className="flex items-end gap-3 rounded-2xl border border-border bg-background p-2 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <button
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="첨부 파일"
          type="button"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="질문을 입력해 주세요."
          disabled={disabled}
          className={cn(
            "min-h-[40px] max-h-[120px] flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none",
          )}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all",
            message.trim() && !disabled
              ? "bg-primary text-primary-foreground shadow-md hover:scale-105 hover:shadow-lg"
              : "cursor-not-allowed bg-muted text-muted-foreground",
          )}
          aria-label="메시지 전송"
          type="button"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">Shift + Enter로 줄바꿈 가능합니다.</p>
    </div>
  )
}
