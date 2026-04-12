import type { Message } from "@/components/chatbot/chat-message"

export type ChatExportFormat = "txt" | "md" | "pdf"

const FORMAT_LABEL: Record<ChatExportFormat, string> = {
  txt: "텍스트",
  md: "Markdown",
  pdf: "PDF 인쇄",
}

function formatExportedAt(): string {
  return new Date().toLocaleString("ko-KR")
}

function formatMessageTime(timestamp: Date | string): string {
  const ts = typeof timestamp === "string" ? new Date(timestamp) : timestamp
  return ts.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
}

function formatSender(message: Message): string {
  return message.sender === "user" ? "사용자" : (message.title ?? "AI Core")
}

function createFileStem(): string {
  return `chat_export_${new Date().toISOString().slice(0, 10)}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function buildPlainText(messages: Message[]): string {
  const lines: string[] = [
    "=== 코비전 CS AI Core 대화 내보내기 ===",
    `내보낸 시각: ${formatExportedAt()}`,
    "",
  ]

  for (const message of messages) {
    lines.push(`[${formatMessageTime(message.timestamp)}] ${formatSender(message)}`)
    lines.push(message.content)
    if (message.linkUrl) {
      lines.push(`  링크: ${message.linkUrl}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

function buildMarkdown(messages: Message[]): string {
  const lines: string[] = [
    "# 코비전 CS AI Core 대화 내보내기",
    "",
    `- 내보낸 시각: ${formatExportedAt()}`,
    "",
  ]

  for (const message of messages) {
    lines.push(`## [${formatMessageTime(message.timestamp)}] ${formatSender(message)}`)
    lines.push("")
    lines.push(message.content)
    if (message.linkUrl) {
      lines.push("")
      lines.push(`- 참고 링크: ${message.linkUrl}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

function buildPrintableHtml(messages: Message[]): string {
  const items = messages
    .map((message) => {
      const link = message.linkUrl
        ? `<a class="link" href="${escapeHtml(message.linkUrl)}">${escapeHtml(message.linkUrl)}</a>`
        : ""

      return `
        <section class="message ${message.sender}">
          <div class="meta">[${escapeHtml(formatMessageTime(message.timestamp))}] ${escapeHtml(formatSender(message))}</div>
          <div class="content">${escapeHtml(message.content)}</div>
          ${link ? `<div class="link-row">참고 링크: ${link}</div>` : ""}
        </section>
      `
    })
    .join("")

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>코비전 CS AI Core 대화 내보내기</title>
  <style>
    @page { margin: 18mm; }
    body {
      color: #172033;
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      line-height: 1.6;
      margin: 0;
    }
    h1 {
      border-bottom: 2px solid #2563eb;
      font-size: 20px;
      margin: 0 0 8px;
      padding-bottom: 8px;
    }
    .exported-at {
      color: #64748b;
      font-size: 12px;
      margin-bottom: 24px;
    }
    .message {
      border: 1px solid #dbe3ef;
      border-radius: 12px;
      margin-bottom: 14px;
      padding: 14px 16px;
      page-break-inside: avoid;
    }
    .message.user { background: #eff6ff; }
    .message.bot { background: #ffffff; }
    .meta {
      color: #2563eb;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .content {
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .link-row {
      color: #475569;
      font-size: 12px;
      margin-top: 10px;
      word-break: break-all;
    }
    .link { color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>코비전 CS AI Core 대화 내보내기</h1>
  <div class="exported-at">내보낸 시각: ${escapeHtml(formatExportedAt())}</div>
  ${items}
  <script>
    window.addEventListener("load", () => {
      window.focus();
      setTimeout(() => window.print(), 250);
    });
  </script>
</body>
</html>`
}

function downloadFile(content: string, fileName: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function openPrintWindow(content: string): void {
  const printWindow = window.open("", "_blank", "width=900,height=720")
  if (!printWindow) {
    throw new Error("브라우저에서 인쇄 창을 열지 못했습니다. 팝업 차단 설정을 확인해 주세요.")
  }

  printWindow.document.open()
  printWindow.document.write(content)
  printWindow.document.close()
}

export function exportChatMessages(messages: Message[], format: ChatExportFormat): string {
  const fileStem = createFileStem()

  if (format === "md") {
    const fileName = `${fileStem}.md`
    downloadFile(buildMarkdown(messages), fileName, "text/markdown;charset=utf-8")
    return fileName
  }

  if (format === "pdf") {
    openPrintWindow(buildPrintableHtml(messages))
    return "인쇄 화면"
  }

  const fileName = `${fileStem}.txt`
  downloadFile(buildPlainText(messages), fileName, "text/plain;charset=utf-8")
  return fileName
}

export function getChatExportFormatLabel(format: ChatExportFormat): string {
  return FORMAT_LABEL[format]
}
