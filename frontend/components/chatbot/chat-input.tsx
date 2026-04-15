"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { History, Paperclip, Send } from "lucide-react"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  prefill?: { value: string; seq: number }
  recentQuestions?: string[]
}

export function ChatInput({ onSend, disabled, prefill, recentQuestions = [] }: ChatInputProps) {
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

  function handleAttachmentClick() {
    window.alert("첨부파일 기능은 추후 지원 예정입니다.")
  }

  return (
    <div className="shrink-0 border-t border-border bg-card px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 md:p-4">
      {recentQuestions.length > 0 ? (
        <div className="mb-2">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {recentQuestions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => setMessage(question)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <History className="h-3.5 w-3.5" />
                <span className="max-w-[220px] truncate">{question}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 md:gap-3">
        <button
          onClick={handleAttachmentClick}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:h-9 md:w-9 md:rounded-lg"
          aria-label="첨부 파일"
          title="첨부 파일"
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
      <div className="mt-2 flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-muted-foreground md:text-xs">
          오류 문구, 메뉴 경로, 제품명을 함께 적으면 더 정확해집니다.
        </p>
        <p className="hidden text-xs text-muted-foreground md:block">Shift + Enter로 줄바꿈 가능합니다.</p>
      </div>
    </div>
  )
}
