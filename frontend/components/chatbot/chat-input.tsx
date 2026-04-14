"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Paperclip, Send } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  prefill?: { value: string; seq: number }
}

export function ChatInput({ onSend, disabled, prefill }: ChatInputProps) {
  const [message, setMessage] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (prefill?.value) setMessage(prefill.value)
  }, [prefill?.seq, prefill?.value])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
  }, [message])

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
    <div className="shrink-0 border-t border-border bg-card px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 md:p-4">
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 md:gap-3">
        <button
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:h-9 md:w-9 md:rounded-lg"
          aria-label="첨부 파일"
          type="button"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="질문을 입력해 주세요."
          disabled={disabled}
          className={cn(
            "max-h-[120px] min-h-11 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed md:min-h-10 md:text-sm",
          )}
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all md:h-9 md:w-9",
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
      <p className="mt-2 hidden text-center text-xs text-muted-foreground md:block">
        Shift + Enter로 줄바꿈 가능합니다.
      </p>
    </div>
  )
}
